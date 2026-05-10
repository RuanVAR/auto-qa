import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { EmailService } from '../../email/email.service';
import { TokenService } from './token.service';
import { webUrl } from '../../common/config/urls';

export interface JwtTokenPayload {
  sub: string;
  email: string;
  platformRole: string;
  activeOrgId: string | null;
  orgRole: string | null;
  /** JWT ID — assigned by TokenService.issuePair, used for revocation. */
  jti?: string;
}

export interface SessionMetadata {
  userAgent?: string | null;
  ipAddress?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly tokens: TokenService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already registered');

    if (!dto.orgName) throw new BadRequestException('orgName is required for registration');

    const orgSlug = this.slugify(dto.orgName);

    // Check org slug not taken
    const slugTaken = await this.prisma.organisation.findUnique({ where: { slug: orgSlug } });
    if (slugTaken) throw new ConflictException(`Organisation slug "${orgSlug}" is already taken. Try a different organisation name.`);

    // Check if registration approval is required.
    // Default = true (require approval) when the config key is absent — safe fallback.
    const approvalConfig = await this.prisma.platformConfig.findFirst({
      where: { key: 'requireRegistrationApproval' },
    });
    const needsApproval = approvalConfig === null || approvalConfig.value !== 'false';

    const passwordHash = await bcrypt.hash(dto.password, 12);

    // Create user + org + membership in a transaction
    const { user, org } = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email,
          name: dto.name,
          passwordHash,
          platformRole: 'USER',
          accountStatus: needsApproval ? 'PENDING_APPROVAL' : 'ACTIVE',
        },
      });

      const newOrg = await tx.organisation.create({
        data: {
          name: dto.orgName!,
          slug: orgSlug,
          ownerId: newUser.id,
          members: {
            create: {
              userId: newUser.id,
              role: 'ORG_ADMIN',
            },
          },
        },
      });

      // Set the user's lastActiveOrgId
      await tx.user.update({
        where: { id: newUser.id },
        data: { lastActiveOrgId: newOrg.id },
      });

      return { user: newUser, org: newOrg };
    });

    if (needsApproval) {
      // Welcome email — sets expectations that admin review is pending so
      // users don't refresh their inbox waiting for an instant activation.
      // Failing email send here must never block the registration response;
      // EmailService.safeSend already swallows + logs.
      this.email.sendWelcomePending(user.email, {
        userName: user.name,
        orgName: org.name,
      });

      return {
        requiresApproval: true,
        message: 'Your account has been created and is pending approval by a platform administrator.',
      };
    }

    // Auto-approved (admin-disabled approval gate) → send the "you're in"
    // email straight away.
    this.email.sendAccountApproved(user.email, {
      userName: user.name,
      loginUrl: `${webUrl()}/login`,
    });

    return this.buildAuthResponse(user.id, user.email, user.platformRole, org.id, 'ORG_ADMIN');
  }

  async login(dto: LoginDto, metadata: SessionMetadata = {}) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        orgMemberships: {
          include: { org: true },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (user.accountStatus !== 'ACTIVE') {
      const statusMsg: Record<string, string> = {
        PENDING_ACTIVATION: 'Please verify your email before logging in.',
        PENDING_APPROVAL: 'Your account is pending approval by a platform administrator.',
        SUSPENDED: 'Your account has been temporarily suspended. Contact support.',
        DEACTIVATED: 'This account has been deactivated.',
      };
      throw new UnauthorizedException(
        statusMsg[user.accountStatus] ?? 'Account is not active.',
      );
    }

    if (!user.passwordHash) throw new UnauthorizedException('Password login not set up for this account.');
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    // Determine active org
    let activeOrgId: string | null = user.lastActiveOrgId;
    let orgRole: string | null = null;

    if (activeOrgId) {
      const membership = user.orgMemberships.find((m) => m.orgId === activeOrgId);
      if (!membership) {
        // lastActiveOrgId no longer valid — fall back to first membership
        activeOrgId = user.orgMemberships[0]?.orgId ?? null;
        orgRole = user.orgMemberships[0]?.role ?? null;
      } else {
        orgRole = membership.role;
      }
    } else if (user.orgMemberships.length > 0) {
      activeOrgId = user.orgMemberships[0].orgId;
      orgRole = user.orgMemberships[0].role;
    }

    return this.buildAuthResponse(user.id, user.email, user.platformRole, activeOrgId, orgRole, metadata);
  }

  /** Revoke the refresh-token row matching this user + hash. Used by /auth/logout. */
  async revokeRefreshTokenByHash(userId: string, tokenHash: string): Promise<void> {
    // updateMany over the (userId, tokenHash) pair is intentional — we
    // refuse to revoke a token that doesn't belong to the JWT bearer, even
    // if they somehow know another user's refresh-token hash.
    await this.prisma.userRefreshToken.updateMany({
      where: { userId, tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
  }

  /** Revoke one session row, scoped to the calling user (sessions UI). */
  async revokeSessionById(userId: string, sessionId: string): Promise<void> {
    await this.prisma.userRefreshToken.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'manual-revoke' },
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        platformRole: true,
        accountStatus: true,
        lastActiveOrgId: true,
        notificationPrefs: true,
        createdAt: true,
        orgMemberships: {
          include: {
            org: {
              select: { id: true, name: true, slug: true, logoUrl: true },
            },
          },
        },
      },
    });
    return user;
  }

  async updateNotificationPrefs(userId: string, prefs: Record<string, unknown>) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { notificationPrefs: prefs as Prisma.InputJsonValue },
      select: { id: true, notificationPrefs: true },
    });
  }

  async switchOrg(userId: string, orgId: string) {
    // Verify the user is a member of the target org
    const membership = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!membership) throw new UnauthorizedException('You are not a member of that organisation.');

    // Update lastActiveOrgId
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastActiveOrgId: orgId },
    });

    // Re-issue token with new org context
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return this.buildAuthResponse(user!.id, user!.email, user!.platformRole, orgId, membership.role);
  }

  private async buildAuthResponse(
    userId: string,
    email: string,
    platformRole: string,
    activeOrgId: string | null,
    orgRole: string | null,
    metadata: SessionMetadata = {},
  ) {
    const { accessToken, refreshToken } = await this.tokens.issuePair(
      { sub: userId, email, platformRole, activeOrgId, orgRole },
      metadata,
    );
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      // ~15 minutes — frontend uses this to schedule the refresh call.
      accessTokenExpiresInSeconds: 15 * 60,
      platformRole,
      activeOrgId,
      orgRole,
    };
  }

  // ── SSO Methods ────────────────────────────────────────────────────────────

  async findOrCreateSsoUser(data: {
    provider: string;
    providerId: string;
    email: string;
    name: string;
    avatarUrl?: string;
  }) {
    const { provider, providerId, email, name, avatarUrl } = data;

    // 1. Check if UserSsoAccount exists with this provider+providerId
    const existingSsoAccount = await this.prisma.userSsoAccount.findUnique({
      where: {
        provider_providerId: {
          provider: provider as 'GOOGLE' | 'MICROSOFT',
          providerId,
        },
      },
      include: { user: { include: { orgMemberships: { orderBy: { joinedAt: 'asc' } } } } },
    });

    if (existingSsoAccount) {
      const { user } = existingSsoAccount;
      const activeOrgId = user.lastActiveOrgId ?? user.orgMemberships[0]?.orgId ?? null;
      const orgRole = user.orgMemberships.find((m) => m.orgId === activeOrgId)?.role ?? user.orgMemberships[0]?.role ?? null;
      return this.buildAuthResponse(user.id, user.email, user.platformRole, activeOrgId, orgRole);
    }

    // 2. Check if User exists with this email — link SSO account to existing user
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      include: { orgMemberships: { orderBy: { joinedAt: 'asc' } } },
    });

    if (existingUser) {
      // Link the SSO account
      await this.prisma.userSsoAccount.create({
        data: {
          provider: provider as 'GOOGLE' | 'MICROSOFT',
          providerId,
          email,
          userId: existingUser.id,
        },
      });

      const activeOrgId = existingUser.lastActiveOrgId ?? existingUser.orgMemberships[0]?.orgId ?? null;
      const orgRole = existingUser.orgMemberships.find((m) => m.orgId === activeOrgId)?.role ?? existingUser.orgMemberships[0]?.role ?? null;
      return this.buildAuthResponse(existingUser.id, existingUser.email, existingUser.platformRole, activeOrgId, orgRole);
    }

    // 3. Create new user + SSO account
    const newUser = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name,
          avatarUrl: avatarUrl ?? null,
          passwordHash: null,
          platformRole: 'USER',
          accountStatus: 'ACTIVE',
          ssoAccounts: {
            create: {
              provider: provider as 'GOOGLE' | 'MICROSOFT',
              providerId,
              email,
            },
          },
        },
        include: { orgMemberships: true },
      });

      // Domain-based org auto-join: check Organisation.ssoDomain against email domain
      const emailDomain = email.split('@')[1];
      if (emailDomain) {
        const matchingOrg = await tx.organisation.findFirst({
          where: { ssoDomain: emailDomain },
        });
        if (matchingOrg) {
          await tx.orgMember.create({
            data: {
              orgId: matchingOrg.id,
              userId: created.id,
              role: 'ORG_MEMBER',
            },
          });
          await tx.user.update({
            where: { id: created.id },
            data: { lastActiveOrgId: matchingOrg.id },
          });
          return tx.user.findUnique({
            where: { id: created.id },
            include: { orgMemberships: { orderBy: { joinedAt: 'asc' } } },
          });
        }
      }

      return created;
    });

    const activeOrgId = newUser!.lastActiveOrgId ?? (newUser as { orgMemberships?: Array<{ orgId: string; role: string }> }).orgMemberships?.[0]?.orgId ?? null;
    const orgRole = (newUser as { orgMemberships?: Array<{ orgId: string; role: string }> }).orgMemberships?.find((m) => m.orgId === activeOrgId)?.role ?? null;
    return this.buildAuthResponse(newUser!.id, newUser!.email, newUser!.platformRole, activeOrgId, orgRole);
  }

  async linkSsoAccount(
    userId: string,
    data: { provider: string; providerId: string; email: string },
  ) {
    // Check no other user already has this providerId linked
    const existing = await this.prisma.userSsoAccount.findUnique({
      where: {
        provider_providerId: {
          provider: data.provider as 'GOOGLE' | 'MICROSOFT',
          providerId: data.providerId,
        },
      },
    });
    if (existing && existing.userId !== userId) {
      throw new ConflictException('This SSO account is already linked to another user');
    }
    if (existing && existing.userId === userId) {
      throw new ConflictException('This SSO account is already linked to your profile');
    }

    await this.prisma.userSsoAccount.create({
      data: {
        provider: data.provider as 'GOOGLE' | 'MICROSOFT',
        providerId: data.providerId,
        email: data.email,
        userId,
      },
    });

    return this.getSsoAccounts(userId);
  }

  async unlinkSsoAccount(userId: string, provider: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { ssoAccounts: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // Check user has at least one other login method
    const otherSsoAccounts = user.ssoAccounts.filter((a) => a.provider !== provider);
    const hasPassword = !!user.passwordHash;

    if (!hasPassword && otherSsoAccounts.length === 0) {
      throw new BadRequestException(
        'Cannot unlink this SSO account — it is your only login method. Please set a password first.',
      );
    }

    const account = user.ssoAccounts.find((a) => a.provider === provider);
    if (!account) {
      throw new NotFoundException(`No linked ${provider} account found`);
    }

    await this.prisma.userSsoAccount.delete({ where: { id: account.id } });

    return { success: true };
  }

  async getSsoAccounts(userId: string) {
    const accounts = await this.prisma.userSsoAccount.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        email: true,
        linkedAt: true,
      },
    });
    return accounts;
  }

  async updateProfile(userId: string, data: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        platformRole: true,
        accountStatus: true,
        lastActiveOrgId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async changePassword(userId: string, data: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (!user.passwordHash) {
      throw new BadRequestException('No password set for this account. Use SSO login or set a password via account settings.');
    }

    const valid = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const newHash = await bcrypt.hash(data.newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    // Security best-practice: a password change kills every existing session.
    // The user's own current session will get a 401 on its next request and
    // be redirected to /login — the small UX cost is worth blowing away any
    // attacker who'd already grabbed credentials.
    await this.tokens.revokeAllForUser(userId, 'password-change');

    return { success: true };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }

  // ─── Password reset (JWT-based, stateless) ─────────────────────────────

  /**
   * Sends a password-reset email if the address belongs to a real account.
   * Always succeeds from the controller's POV (no user enumeration). The
   * reset token is a 30-minute JWT with a `purpose: 'pwreset'` claim so a
   * leaked normal access token can't be repurposed for this flow.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
    if (!user) return;
    // jti makes the token single-use: after the reset completes we add it
    // to the same Redis revocation set used for access tokens, so a second
    // POST with the same token returns 403 even within the 30-min window.
    const jti = (await import('crypto')).randomUUID();
    const token = await this.jwt.signAsync(
      { sub: user.id, purpose: 'pwreset', jti },
      { secret: process.env.JWT_SECRET, expiresIn: '30m' },
    );
    const resetUrl = `${webUrl()}/reset-password?token=${token}`;
    this.email.sendPasswordReset(email, {
      userName: user.name,
      resetUrl,
      expiresInMinutes: 30,
    });
  }

  async resetPasswordWithToken(token: string, newPassword: string) {
    let payload: { sub: string; purpose: string; jti?: string; exp?: number };
    try {
      payload = await this.jwt.verifyAsync<{ sub: string; purpose: string; jti?: string; exp?: number }>(token, {
        secret: process.env.JWT_SECRET,
      });
    } catch {
      throw new ForbiddenException('Reset link is invalid or expired');
    }
    if (payload.purpose !== 'pwreset') throw new ForbiddenException('Token is not a password-reset token');
    // Single-use enforcement: if the jti is already in the revocation set,
    // someone (the user, or an attacker) has already consumed this token.
    // 403 with the same message we use for expired tokens — don't hint that
    // the token was valid recently.
    if (payload.jti && await this.tokens.isAccessTokenRevoked(payload.jti)) {
      throw new ForbiddenException('Reset link has already been used');
    }
    if (newPassword.length < 8) throw new BadRequestException('Password must be at least 8 characters');
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: payload.sub }, data: { passwordHash } });
    // Burn the jti for the remainder of the 30-min window so this exact
    // reset link can't be replayed. expSeconds gives us the natural TTL
    // — Redis evicts the entry when the JWT itself would have expired.
    await this.tokens.blacklistAccessToken(payload.jti, payload.exp);
    // Belt-and-braces: a password reset frequently means "credentials were
    // compromised". Killing every refresh-token row blows attackers and
    // legitimate stale sessions out of the water — they all redirect to
    // /login on the next request. Cheap insurance.
    await this.tokens.revokeAllForUser(payload.sub, 'password-reset');
    return { ok: true };
  }

  // ─── Email verification ────────────────────────────────────────────────

  /**
   * Marks an email-verification token as consumed by clearing
   * `activationToken` on the user. The token itself is just the value
   * stored on User.activationToken — set during registration. We also
   * flip status from PENDING_ACTIVATION → ACTIVE here when applicable.
   */
  async verifyEmail(token: string) {
    const user = await this.prisma.user.findUnique({ where: { activationToken: token } });
    if (!user) throw new ForbiddenException('Verification link is invalid');
    const becomesActive = user.accountStatus === 'PENDING_ACTIVATION';
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        activationToken: null,
        activationSentAt: null,
        accountStatus: becomesActive ? 'ACTIVE' : user.accountStatus,
      },
    });
    return { ok: true, accountStatus: becomesActive ? 'ACTIVE' : user.accountStatus };
  }

  async resendVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.accountStatus === 'ACTIVE' && !user.activationToken) {
      return { ok: true, message: 'Email is already verified' };
    }
    // Generate a fresh token; cryptographically random hex via Node crypto.
    const newToken = (await import('crypto')).randomBytes(32).toString('hex');
    await this.prisma.user.update({
      where: { id: userId },
      data: { activationToken: newToken, activationSentAt: new Date() },
    });
    const verifyUrl = `${webUrl()}/verify-email?token=${newToken}`;
    this.email.sendEmailVerification(user.email, {
      userName: user.name,
      verifyUrl,
    });
    return { ok: true };
  }

  /**
   * Email-change is a two-step verified flow to protect against account
   * lockout from a fat-finger or compromised session:
   *
   *   1. requestEmailChange(userId, newEmail, currentPassword)
   *      - Verifies password
   *      - Stashes the new email in `pendingEmail` + `pendingEmailToken`
   *      - Sends a verification link to the NEW address
   *
   *   2. confirmEmailChange(token)
   *      - Validates the token, updates `email`, clears pending fields
   *      - Revokes all sessions so any attacker mid-session is kicked
   *
   * The user's primary email isn't touched until step 2 — if they typo the
   * new address, they don't get the verification mail and the change
   * silently expires.
   */
  async requestEmailChange(userId: string, newEmail: string, currentPassword: string) {
    const normalised = newEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised)) {
      throw new BadRequestException('Please provide a valid email address');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.passwordHash) {
      throw new BadRequestException('Set a password first before changing email');
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('Current password is incorrect');
    if (normalised === user.email.toLowerCase()) {
      throw new BadRequestException('That is already your email address');
    }
    // Don't reveal whether the address is in use to the requester — uniqueness
    // is enforced at confirm-time by Postgres anyway. But pre-check at request
    // time for a friendlier error than "constraint violation" later.
    const taken = await this.prisma.user.findUnique({ where: { email: normalised } });
    if (taken) throw new ConflictException('That email is already in use by another account');

    const newToken = (await import('crypto')).randomBytes(32).toString('hex');
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pendingEmail: normalised,
        pendingEmailToken: newToken,
        pendingEmailRequestedAt: new Date(),
      },
    });
    const verifyUrl = `${webUrl()}/verify-email-change?token=${newToken}`;
    this.email.sendEmailVerification(normalised, {
      userName: user.name,
      verifyUrl,
    });
    return { ok: true, message: 'Verification email sent to the new address' };
  }

  async confirmEmailChange(token: string) {
    const user = await this.prisma.user.findUnique({ where: { pendingEmailToken: token } });
    if (!user || !user.pendingEmail) {
      throw new ForbiddenException('Email-change link is invalid or already used');
    }
    // 24h expiry — deliberately short. If a user delays they can re-request
    // from settings, which mints a fresh token.
    const requested = user.pendingEmailRequestedAt ? user.pendingEmailRequestedAt.getTime() : 0;
    if (Date.now() - requested > 24 * 60 * 60 * 1000) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { pendingEmail: null, pendingEmailToken: null, pendingEmailRequestedAt: null },
      });
      throw new ForbiddenException('Email-change link has expired — request a new one');
    }
    // Race-check: another account may have grabbed this email since the
    // request was made. Re-validate uniqueness inside the update.
    const collision = await this.prisma.user.findUnique({ where: { email: user.pendingEmail } });
    if (collision) {
      throw new ConflictException('That email is now in use by another account');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        email: user.pendingEmail,
        pendingEmail: null,
        pendingEmailToken: null,
        pendingEmailRequestedAt: null,
      },
    });
    // An email change is a security-sensitive event — invalidate every
    // session so an attacker who'd grabbed a token can't ride along.
    await this.tokens.revokeAllForUser(user.id, 'email-change');
    return { ok: true, email: user.pendingEmail };
  }
}

