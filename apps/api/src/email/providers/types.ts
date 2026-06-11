/**
 * Provider-agnostic email types. Each adapter implements `EmailProvider`
 * and is selected at runtime by EmailService based on EMAIL_PROVIDER env.
 *
 * Keeping the contract narrow on purpose — anything fancier (templates,
 * scheduling, A/B tests) lives in the service layer above this. Providers
 * just deliver one already-rendered message.
 */

export interface EmailAttachment {
  filename: string;
  /** Buffer for in-memory generated content (e.g. PDF reports), or string for HTML/text. */
  content: Buffer | string;
  /** MIME type, e.g. 'application/pdf' or 'text/html'. */
  contentType?: string;
  /** Content-ID for inline embedding — reference as `src="cid:<cid>"` (e.g. logo). */
  cid?: string;
}

export interface EmailMessage {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html: string;
  text?: string;             // optional plain-text fallback (auto-derived if absent)
  replyTo?: string;
  attachments?: EmailAttachment[];
  /**
   * Headers a downstream provider may need (e.g. List-Unsubscribe).
   * Free-form so each provider can map them to its own SDK shape.
   */
  headers?: Record<string, string>;
}

export interface SendResult {
  /** Provider-assigned message id (used in logs + bounce-tracking). */
  messageId: string;
  /** True for sandboxed/dev sends (e.g. Ethereal preview); used to log a preview URL. */
  sandbox?: boolean;
  /** Sandboxed preview URL when applicable. Always logged so devs can find it. */
  previewUrl?: string;
}

/**
 * Implementations:
 *   - NodemailerProvider (current — supports SMTP & Ethereal sandbox)
 *   - MailgunProvider (stub)
 *   - SendGridProvider (stub)
 *
 * Each adapter is constructed once at app boot from EmailService. Send is
 * async-only; never throw from constructors — defer until first send so
 * boot is fast.
 */
export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage): Promise<SendResult>;
  /** Lightweight liveness probe — verifies the transport without sending. */
  verify(): Promise<{ ok: boolean; reason?: string }>;
}
