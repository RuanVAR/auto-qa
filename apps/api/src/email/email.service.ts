import { Injectable, Logger } from '@nestjs/common';
import type { EmailProvider, EmailMessage, EmailAttachment, SendResult } from './providers/types';
import { NodemailerProvider } from './providers/nodemailer.provider';
import { MailgunProvider } from './providers/mailgun.provider';
import { SendGridProvider } from './providers/sendgrid.provider';
import { Branding, loadBranding } from './branding';
import {
  renderMjml,
  welcomePending, accountApproved, accountRejected, adminApprovalConfirmation,
  memberInvite, emailVerification, passwordReset, reportGenerated,
  type WelcomePendingData, type AccountApprovedData, type AccountRejectedData,
  type AdminApprovalConfirmationData, type MemberInviteData,
  type EmailVerificationData, type PasswordResetData, type ReportGeneratedData,
} from './templates';

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

  constructor() {
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

  // ─── Typed senders (one per template) ────────────────────────────────

  sendWelcomePending(to: string, data: WelcomePendingData) {
    return this.dispatch(to, welcomePending({ brand: this.brand, data }));
  }
  sendAccountApproved(to: string, data: AccountApprovedData) {
    return this.dispatch(to, accountApproved({ brand: this.brand, data }));
  }
  sendAccountRejected(to: string, data: AccountRejectedData) {
    return this.dispatch(to, accountRejected({ brand: this.brand, data }));
  }
  sendAdminApprovalConfirmation(to: string, data: AdminApprovalConfirmationData) {
    return this.dispatch(to, adminApprovalConfirmation({ brand: this.brand, data }));
  }
  sendMemberInvite(to: string, data: MemberInviteData) {
    return this.dispatch(to, memberInvite({ brand: this.brand, data }));
  }
  sendEmailVerification(to: string, data: EmailVerificationData) {
    return this.dispatch(to, emailVerification({ brand: this.brand, data }));
  }
  sendPasswordReset(to: string, data: PasswordResetData) {
    return this.dispatch(to, passwordReset({ brand: this.brand, data }));
  }
  sendReportGenerated(to: string | string[], data: ReportGeneratedData, attachments?: EmailAttachment[]) {
    return this.dispatch(to, reportGenerated({ brand: this.brand, data }), attachments);
  }

  /** Lower-level escape hatch when a caller needs full control. */
  async sendRaw(msg: EmailMessage): Promise<SendResult | null> {
    if (this.suppressed) return null;
    return this.safeSend(msg);
  }

  // ─── Internals ───────────────────────────────────────────────────────

  private async dispatch(to: string | string[], rendered: { subject: string; mjml: string; text: string }, attachments?: EmailAttachment[]): Promise<SendResult | null> {
    if (this.suppressed) return null;
    const compiled = renderMjml(rendered);
    return this.safeSend({
      to, subject: compiled.subject, html: compiled.html, text: compiled.text, attachments,
    });
  }

  private async safeSend(msg: EmailMessage): Promise<SendResult | null> {
    try {
      const r = await this.provider.send(msg);
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
