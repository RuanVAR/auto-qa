import type { EmailMessage, EmailProvider, SendResult } from './types';

/** SendGrid adapter — stub. Install `@sendgrid/mail` and replace internals. */
export class SendGridProvider implements EmailProvider {
  readonly name = 'sendgrid';
  constructor(_env: NodeJS.ProcessEnv) {
    throw new Error('SendGrid provider is not yet implemented. Install @sendgrid/mail and replace this stub.');
  }
  async verify(): Promise<{ ok: boolean; reason?: string }> { return { ok: false, reason: 'not implemented' }; }
  async send(_msg: EmailMessage): Promise<SendResult> { throw new Error('SendGrid provider not implemented'); }
}
