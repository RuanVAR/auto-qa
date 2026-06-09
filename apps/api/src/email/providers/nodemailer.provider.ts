import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { EmailMessage, EmailProvider, SendResult } from './types';
import { appName } from '../../common/config/app';

/**
 * Nodemailer-backed email provider.
 *
 * Two modes:
 *
 *   1. SMTP — when EMAIL_HOST / EMAIL_PORT / EMAIL_USER / EMAIL_PASS are set.
 *      Standard SMTP relay (Mailgun SMTP, SendGrid SMTP, Postmark, Office365…).
 *
 *   2. Ethereal sandbox — automatic when EMAIL_PROVIDER=ethereal. nodemailer
 *      creates a throwaway test account + a preview URL we log on every
 *      send. No real delivery. Perfect for dev / CI without leaking emails
 *      to real users.
 *
 * The transporter is created lazily on first send so boot stays fast and
 * a missing SMTP server doesn't break the API.
 */
export class NodemailerProvider implements EmailProvider {
  readonly name = 'nodemailer';
  private transporter: Transporter | null = null;
  private readonly mode: 'smtp' | 'ethereal';
  private readonly fromAddress: string;

  constructor(env: NodeJS.ProcessEnv) {
    this.mode = env.EMAIL_PROVIDER === 'ethereal' ? 'ethereal' : 'smtp';
    // The "From" header is the same regardless of provider — keep branding
    // consistent so users always see the same sender name.
    this.fromAddress = env.EMAIL_FROM ?? `"${appName(env)}" <no-reply@qaplatform.local>`;
  }

  private async ensureTransporter(): Promise<Transporter> {
    if (this.transporter) return this.transporter;
    if (this.mode === 'ethereal') {
      const account = await nodemailer.createTestAccount();
      this.transporter = nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
      });
      // Log the test creds *once* so a curious dev can sign in to ethereal
      // directly. Pass remains in stdout only, never in payloads.
      console.log(`[email] Ethereal test account: ${account.user} (preview URLs will appear per-send)`);
    } else {
      const host = process.env.EMAIL_HOST;
      const port = Number(process.env.EMAIL_PORT ?? 587);
      if (!host) {
        throw new Error('SMTP transport requires EMAIL_HOST (and usually EMAIL_USER / EMAIL_PASS). Set EMAIL_PROVIDER=ethereal for dev.');
      }
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: process.env.EMAIL_USER ? {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        } : undefined,
      });
    }
    return this.transporter;
  }

  async verify(): Promise<{ ok: boolean; reason?: string }> {
    try {
      const t = await this.ensureTransporter();
      await t.verify();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err as Error)?.message ?? String(err) };
    }
  }

  async send(msg: EmailMessage): Promise<SendResult> {
    const t = await this.ensureTransporter();
    const info = await t.sendMail({
      from: this.fromAddress,
      to: Array.isArray(msg.to) ? msg.to.join(', ') : msg.to,
      cc: msg.cc ? (Array.isArray(msg.cc) ? msg.cc.join(', ') : msg.cc) : undefined,
      bcc: msg.bcc ? (Array.isArray(msg.bcc) ? msg.bcc.join(', ') : msg.bcc) : undefined,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      replyTo: msg.replyTo,
      attachments: msg.attachments?.map(a => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
      headers: msg.headers,
    });

    const previewUrl = this.mode === 'ethereal'
      ? (nodemailer.getTestMessageUrl(info) || undefined)
      : undefined;
    return {
      messageId: info.messageId,
      sandbox: this.mode === 'ethereal',
      previewUrl: previewUrl || undefined,
    };
  }
}
