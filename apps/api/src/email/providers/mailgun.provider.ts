import type { EmailMessage, EmailProvider, SendResult } from './types';

/**
 * Mailgun adapter — stub. Wire up by installing `mailgun.js` + `form-data`
 * and replacing the stub implementations. Kept here so a deployment can
 * switch to Mailgun by:
 *   1. EMAIL_PROVIDER=mailgun
 *   2. MAILGUN_API_KEY=…  MAILGUN_DOMAIN=…
 *   3. pnpm --filter api add mailgun.js form-data
 */
export class MailgunProvider implements EmailProvider {
  readonly name = 'mailgun';

  // Reads env at construction so the EmailService boot fails loudly if
  // the operator picked Mailgun without supplying creds. Better than
  // silently falling back to nodemailer.
  constructor(_env: NodeJS.ProcessEnv) {
    throw new Error('Mailgun provider is not yet implemented. Install mailgun.js and replace this stub, or set EMAIL_PROVIDER=ethereal/smtp.');
  }
  async verify(): Promise<{ ok: boolean; reason?: string }> { return { ok: false, reason: 'not implemented' }; }
  async send(_msg: EmailMessage): Promise<SendResult> { throw new Error('Mailgun provider not implemented'); }
}
