import { Injectable, Logger } from '@nestjs/common';
import type { EmailProvider, EmailMessage, EmailAttachment, SendResult } from './providers/types';
import { NodemailerProvider } from './providers/nodemailer.provider';
import { MailgunProvider } from './providers/mailgun.provider';
import { SendGridProvider } from './providers/sendgrid.provider';
import { Branding, loadBranding } from './branding';
import { DEFAULT_EMAIL_LOGO_BASE64, DEFAULT_EMAIL_LOGO_CONTENT_TYPE } from './logo-asset';
import { withTimeout } from '../common/util/timeout';
import { PlatformBrandingService } from '../modules/platform/platform-branding.service';
import {
  renderMjml,
  welcomePending, accountApproved, accountRejected, adminApprovalConfirmation,
  memberInvite, emailVerification, passwordReset, reportGenerated,
  signoffRequest, signoffCompleted, accessRequestCreated,
  type WelcomePendingData, type AccountApprovedData, type AccountRejectedData,
  type AdminApprovalConfirmationData, type MemberInviteData,
  type EmailVerificationData, type PasswordResetData, type ReportGeneratedData,
  type SignoffRequestData, type SignoffCompletedData, type AccessRequestCreatedData,
} from './templates';

/** Per-send branding override for org-scoped emails (invite, report). */
export interface OrgBrandOverride {
  name?: string | null;
  logoUrl?: string | null;
}

/**
 * EmailService — single import point for sending email anywhere in the API.
 *
 * Design:
 *   - One provider, picked at boot from EMAIL_PROVIDER env (defaults to
 *     nodemailer + ethereal in dev, smtp in prod).
 *   - Each named template is exposed as a typed method (sendWelcomePending,
 *     sendAccountApproved, …) so call-sites can't pass the wrong data shape.
 *   - All sends are wrapped to never throw — a bounce or transient SMTP
 *     failure must never break the user-facing flow that triggered it.
 *     Caller can opt-in to throw via { throwOnError: true }.
 *
 * Adding a new provider:
 *   1. Implement EmailProvider in `providers/<name>.provider.ts`.
 *   2. Add a case to `selectProvider()`.
 *   3. Document the env vars it needs.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly provider: EmailProvider;
  private readonly brand: Branding;
  private readonly suppressed: boolean;

  constructor(private readonly platformBranding: PlatformBrandingService) {
    this.brand = loadBranding(process.env);
    // EMAIL_DISABLED=1 turns sending into a no-op — useful for tests.
    this.suppressed = process.env.EMAIL_DISABLED === '1';
    this.provider = this.selectProvider(process.env);
    this.logger.log(`Email transport: ${this.provider.name}${this.suppressed ? ' (disabled)' : ''}`);
  }

  /** Provider verify (used by /health probes). Returns ok:false rather than throwing. */
  async verify() {
    if (this.suppressed) return { ok: true, reason: 'disabled' };
    return this.provider.verify();
  }

  /**
   * Resolve the brand for an email: org override (if any) → platform default
   * (set by a platform admin) → env/built-in. Org name/logo win when present;
   * otherwise the platform logo/name applies; otherwise the env defaults.
   * Colours + support email always come from the env brand.
   */
  private async resolvedBrand(org?: OrgBrandOverride): Promise<Branding> {
    const platform = await this.platformBranding.get();
    return {
      ...this.brand,
      appName: org?.name || platform.appName || this.brand.appName,
      logoUrl: org?.logoUrl ?? platform.logoUrl ?? this.brand.logoUrl,
    };
  }

  // ─── Typed senders (one per template) ────────────────────────────────
  // All sends resolve branding through resolvedBrand() so the platform-wide
  // default logo/name applies everywhere; org-scoped sends pass an org override.

  async sendWelcomePending(to: string, data: WelcomePendingData) {
    return this.compose(to, welcomePending, data);
  }
  async sendAccountApproved(to: string, data: AccountApprovedData) {
    return this.compose(to, accountApproved, data);
  }
  async sendAccountRejected(to: string, data: AccountRejectedData) {
    return this.compose(to, accountRejected, data);
  }
  async sendAdminApprovalConfirmation(to: string, data: AdminApprovalConfirmationData) {
    return this.compose(to, adminApprovalConfirmation, data);
  }
  async sendMemberInvite(to: string, data: MemberInviteData, org?: OrgBrandOverride) {
    return this.compose(to, memberInvite, data, { org });
  }
  /** Notify org admins / project leads that someone requested access. */
  async sendAccessRequestCreated(to: string | string[], data: AccessRequestCreatedData, org?: OrgBrandOverride) {
    return this.compose(to, accessRequestCreated, data, { org });
  }
  async sendEmailVerification(to: string, data: EmailVerificationData) {
    return this.compose(to, emailVerification, data);
  }
  async sendPasswordReset(to: string, data: PasswordResetData) {
    return this.compose(to, passwordReset, data);
  }
  async sendSignoffRequest(to: string | string[], data: SignoffRequestData, org?: OrgBrandOverride) {
    return this.compose(to, signoffRequest, data, { org });
  }
  async sendSignoffCompleted(to: string | string[], data: SignoffCompletedData, org?: OrgBrandOverride) {
    return this.compose(to, signoffCompleted, data, { org });
  }
  /** Sign-off completed email with the certificate attached (PDF, or HTML fallback). */
  async sendSignoffCertificate(to: string | string[], data: SignoffCompletedData, attachment: EmailAttachment, org?: OrgBrandOverride) {
    return this.compose(to, signoffCompleted, data, { org, attachments: [attachment] });
  }
  async sendReportGenerated(to: string | string[], data: ReportGeneratedData, attachments?: EmailAttachment[], org?: OrgBrandOverride) {
    return this.compose(to, reportGenerated, data, { org, attachments });
  }

  /**
   * Resolve brand → embed the logo inline (CID) → render → dispatch. Embedding
   * the brand mark as an attachment makes it render in every client without
   * depending on a public logo URL being reachable (which it isn't from an
   * email client pointing at a localhost / private web URL).
   */
  private async compose<T>(
    to: string | string[],
    templateFn: (ctx: { brand: Branding; data: T }) => { subject: string; mjml: string; text: string },
    data: T,
    opts?: { org?: OrgBrandOverride; attachments?: EmailAttachment[] },
  ): Promise<SendResult | null> {
    const brand = await this.resolvedBrand(opts?.org);
    const { brand: branded, logoAttachment } = this.embedLogo(brand);
    const rendered = templateFn({ brand: branded, data });
    const attachments = [logoAttachment, ...(opts?.attachments ?? [])].filter(
      (a): a is EmailAttachment => !!a,
    );
    return this.dispatch(to, rendered, attachments.length ? attachments : undefined);
  }

  /**
   * When the logo is the default platform asset, swap the URL for an inline CID
   * reference and return the bundled image as the attachment — so it renders
   * everywhere. Org/platform-uploaded or custom logo URLs are left as-is (those
   * are absolute and publicly reachable in prod).
   */
  private embedLogo(brand: Branding): { brand: Branding; logoAttachment?: EmailAttachment } {
    if (!brand.logoUrl || brand.logoUrl !== this.brand.logoUrl) {
      return { brand };
    }
    return {
      brand: { ...brand, logoUrl: 'cid:brand-logo' },
      logoAttachment: {
        filename: 'advantage-logo.png',
        content: Buffer.from(DEFAULT_EMAIL_LOGO_BASE64, 'base64'),
        contentType: DEFAULT_EMAIL_LOGO_CONTENT_TYPE,
        cid: 'brand-logo',
      },
    };
  }

  /** Lower-level escape hatch when a caller needs full control. */
  async sendRaw(msg: EmailMessage): Promise<SendResult | null> {
    if (this.suppressed) return null;
    return this.safeSend(msg);
  }

  // ─── Internals ───────────────────────────────────────────────────────

  private async dispatch(to: string | string[], rendered: { subject: string; mjml: string; text: string }, attachments?: EmailAttachment[]): Promise<SendResult | null> {
    if (this.suppressed) return null;
    // MJML 5 compile is async — await it. Without this, html would be
    // a Promise stringified to "{}" and recipients get a blank email body.
    const compiled = await renderMjml(rendered);
    return this.safeSend({
      to, subject: compiled.subject, html: compiled.html, text: compiled.text, attachments,
    });
  }

  private async safeSend(msg: EmailMessage): Promise<SendResult | null> {
    try {
      // Outer bound across ANY provider (SMTP socket timeouts cover nodemailer;
      // this also caps Mailgun/SendGrid HTTP). Email is best-effort — a timeout
      // just logs + returns null below, never blocks the caller.
      const r = await withTimeout(this.provider.send(msg), 25_000, 'email send');
      this.logger.log(
        `→ "${msg.subject}" to ${Array.isArray(msg.to) ? msg.to.join(',') : msg.to} ` +
        `(id=${r.messageId}${r.previewUrl ? `, preview=${r.previewUrl}` : ''})`,
      );
      return r;
    } catch (err) {
      // Never let an email outage break the calling flow (registration,
      // approval, etc). Log loudly and return null so the caller can decide
      // whether to surface to the user.
      this.logger.error(`Email send failed: ${(err as Error)?.message ?? err}`);
      return null;
    }
  }

  private selectProvider(env: NodeJS.ProcessEnv): EmailProvider {
    const choice = (env.EMAIL_PROVIDER ?? 'ethereal').toLowerCase();
    switch (choice) {
      case 'mailgun':  return new MailgunProvider(env);
      case 'sendgrid': return new SendGridProvider(env);
      case 'smtp':
      case 'nodemailer':
      case 'ethereal':
      default:
        return new NodemailerProvider(env);
    }
  }
}
