// MJML 5 ships ESM and CJS with a `.default` export. Pulling the right
// callable shape is brittle across bundlers — normalise it once here.
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
const mjmlMod: any = require('mjml');
// MJML 5 returns a Promise. Earlier versions were sync — the existing
// `await` in renderMjml() handles both shapes (awaiting a non-Promise is
// a no-op).
type MjmlFn = (
  input: string,
  opts?: { validationLevel?: 'strict' | 'soft' | 'skip' },
) => Promise<{ html: string; errors?: Array<{ formattedMessage: string }> }>;
const mjml2html: MjmlFn = (mjmlMod.default ?? mjmlMod);
import type { Branding } from '../branding';
import { renderLayout } from './layout.mjml';

/**
 * Template registry. Each template is a TS function `(branding, data) =>
 * { subject, mjml, text? }`. The render() helper compiles the MJML to HTML
 * and returns the EmailMessage-ready { subject, html, text }.
 *
 * Why TS functions instead of `.mjml` files on disk?
 *   - Type-safe data params (each template has its own input shape).
 *   - Easy interpolation of branding values (which are dynamic per env).
 *   - One bundle, no runtime fs reads → faster cold start.
 *
 * Adding a new template:
 *   1. Add the function below + export it.
 *   2. Call render(brand, mod.template, data) from EmailService.
 *   3. (Optional) Add to the TemplateName enum if you want a nice public
 *      surface for "send by name".
 */

export type TemplateName =
  | 'welcome-pending'
  | 'account-approved'
  | 'account-rejected'
  | 'admin-approval-confirmation'
  | 'member-invite'
  | 'email-verification'
  | 'password-reset'
  | 'report-generated';

export interface RenderResult {
  subject: string;
  html: string;
  text: string;
}

export interface TemplateContext<TData> {
  brand: Branding;
  data: TData;
}

// ─── Template definitions ──────────────────────────────────────────────────

export interface WelcomePendingData {
  userName: string;
  orgName: string;
}
export function welcomePending({ brand, data }: TemplateContext<WelcomePendingData>): { subject: string; mjml: string; text: string } {
  const subject = `Welcome to ${brand.appName} — your account is being reviewed`;
  const mjml = renderLayout(brand, `
    <mj-section padding="32px 24px 16px">
      <mj-column>
        <mj-text font-size="22px" font-weight="700" padding-bottom="12px">
          Welcome, ${esc(data.userName)} 👋
        </mj-text>
        <mj-text padding-bottom="12px">
          Thanks for signing up to <strong>${esc(brand.appName)}</strong> for the
          <strong>${esc(data.orgName)}</strong> organisation. Before you can sign in,
          a platform administrator needs to review and approve your account — this
          usually happens within a business day.
        </mj-text>
        <mj-text padding-bottom="12px">
          We'll email you the moment your account is ready. No further action is
          needed from you right now.
        </mj-text>
        <mj-text css-class="muted">
          Wrong address? Just ignore this email — no account is created until an
          admin approves the request.
        </mj-text>
      </mj-column>
    </mj-section>
  `, { previewText: `Your ${brand.appName} account is pending admin approval.` });
  const text = [
    `Welcome, ${data.userName}`,
    ``,
    `Thanks for signing up to ${brand.appName} for the ${data.orgName} organisation. A platform admin will review your registration shortly.`,
    ``,
    `We'll email you again the moment your account is approved.`,
    ``,
    `Need help? ${brand.supportEmail}`,
  ].join('\n');
  return { subject, mjml, text };
}

export interface AccountApprovedData {
  userName: string;
  loginUrl: string;
  approverName?: string;
}
export function accountApproved({ brand, data }: TemplateContext<AccountApprovedData>): { subject: string; mjml: string; text: string } {
  const subject = `Your ${brand.appName} account is ready`;
  const mjml = renderLayout(brand, `
    <mj-section padding="32px 24px 16px">
      <mj-column>
        <mj-text font-size="22px" font-weight="700" padding-bottom="12px">
          You're in, ${esc(data.userName)} 🎉
        </mj-text>
        <mj-text padding-bottom="16px">
          ${data.approverName ? `${esc(data.approverName)} just approved your account` : `Your account has been approved`}.
          You can sign in now and start testing.
        </mj-text>
        <mj-button href="${esc(data.loginUrl)}">Sign in to ${esc(brand.appName)}</mj-button>
        <mj-text padding-top="20px" css-class="muted">
          Trouble with the button? Paste this URL into your browser:
          <span class="codeblock">${esc(data.loginUrl)}</span>
        </mj-text>
      </mj-column>
    </mj-section>
  `, { previewText: `Your ${brand.appName} account has been approved.` });
  const text = `Your ${brand.appName} account has been approved. Sign in: ${data.loginUrl}`;
  return { subject, mjml, text };
}

export interface AccountRejectedData {
  userName: string;
  reason?: string;
}
export function accountRejected({ brand, data }: TemplateContext<AccountRejectedData>): { subject: string; mjml: string; text: string } {
  const subject = `Your ${brand.appName} registration was not approved`;
  const mjml = renderLayout(brand, `
    <mj-section padding="32px 24px 16px">
      <mj-column>
        <mj-text font-size="22px" font-weight="700" padding-bottom="12px">
          Hi ${esc(data.userName)},
        </mj-text>
        <mj-text padding-bottom="12px">
          Unfortunately, an admin reviewed your registration and was not able to
          approve it for ${esc(brand.appName)} at this time.
        </mj-text>
        ${data.reason ? `<mj-text padding-bottom="12px"><strong>Reason given:</strong> ${esc(data.reason)}</mj-text>` : ''}
        <mj-text>
          If you think this is a mistake, reply to this email or contact
          <a href="mailto:${esc(brand.supportEmail)}">${esc(brand.supportEmail)}</a>.
        </mj-text>
      </mj-column>
    </mj-section>
  `, { previewText: 'Your registration was not approved.' });
  const text = `Hi ${data.userName}, your ${brand.appName} registration was not approved.${data.reason ? ' Reason: ' + data.reason : ''} Contact ${brand.supportEmail} if you have questions.`;
  return { subject, mjml, text };
}

export interface AdminApprovalConfirmationData {
  adminName: string;
  approvedUserName: string;
  approvedUserEmail: string;
  decision: 'APPROVED' | 'REJECTED';
}
export function adminApprovalConfirmation({ brand, data }: TemplateContext<AdminApprovalConfirmationData>): { subject: string; mjml: string; text: string } {
  const wasApproved = data.decision === 'APPROVED';
  const subject = `${wasApproved ? 'Approved' : 'Rejected'}: ${data.approvedUserName}`;
  const mjml = renderLayout(brand, `
    <mj-section padding="32px 24px 16px">
      <mj-column>
        <mj-text font-size="20px" font-weight="700" padding-bottom="10px">
          Audit confirmation
        </mj-text>
        <mj-text padding-bottom="12px">
          Hi ${esc(data.adminName)} — confirming that you
          ${wasApproved ? '<strong style="color:#059669">approved</strong>' : '<strong style="color:#dc2626">rejected</strong>'}
          the registration for:
        </mj-text>
        <mj-text padding-bottom="12px">
          <strong>${esc(data.approvedUserName)}</strong><br/>
          <span class="muted">${esc(data.approvedUserEmail)}</span>
        </mj-text>
        <mj-text css-class="muted">
          This is an audit-trail copy — the user has been notified separately.
        </mj-text>
      </mj-column>
    </mj-section>
  `);
  const text = `Confirming you ${wasApproved ? 'approved' : 'rejected'} the registration for ${data.approvedUserName} <${data.approvedUserEmail}>.`;
  return { subject, mjml, text };
}

export interface MemberInviteData {
  inviterName: string;
  orgName: string;
  acceptUrl: string;
  projectAssignmentsSummary?: string; // human-readable list, e.g. "TWAK Project (QA_ENGINEER, UAT)"
}
export function memberInvite({ brand, data }: TemplateContext<MemberInviteData>): { subject: string; mjml: string; text: string } {
  const subject = `${data.inviterName} invited you to ${data.orgName} on ${brand.appName}`;
  const mjml = renderLayout(brand, `
    <mj-section padding="32px 24px 16px">
      <mj-column>
        <mj-text font-size="22px" font-weight="700" padding-bottom="12px">
          You've been invited 🎟️
        </mj-text>
        <mj-text padding-bottom="14px">
          <strong>${esc(data.inviterName)}</strong> invited you to join
          <strong>${esc(data.orgName)}</strong> on ${esc(brand.appName)}.
        </mj-text>
        ${data.projectAssignmentsSummary ? `
        <mj-text padding-bottom="14px">
          You'll be assigned to: <strong>${esc(data.projectAssignmentsSummary)}</strong>
        </mj-text>` : ''}
        <mj-button href="${esc(data.acceptUrl)}">Accept invite</mj-button>
        <mj-text padding-top="20px" css-class="muted">
          The invite expires in 7 days. If the button doesn't work, paste this
          link into your browser:
          <span class="codeblock">${esc(data.acceptUrl)}</span>
        </mj-text>
      </mj-column>
    </mj-section>
  `, { previewText: `${data.inviterName} invited you to ${data.orgName}.` });
  const text = `${data.inviterName} invited you to ${data.orgName}. Accept: ${data.acceptUrl}`;
  return { subject, mjml, text };
}

export interface AccessRequestCreatedData {
  requesterName: string;
  requesterEmail: string;
  orgName: string;
  /** "your organisation" (ORG request) or the project name (PROJECT request). */
  scopeLabel: string;
  reviewUrl: string;
  message?: string;
}
export function accessRequestCreated({ brand, data }: TemplateContext<AccessRequestCreatedData>): { subject: string; mjml: string; text: string } {
  const subject = `${data.requesterName} requested access to ${data.scopeLabel}`;
  const mjml = renderLayout(brand, `
    <mj-section padding="32px 24px 16px">
      <mj-column>
        <mj-text font-size="22px" font-weight="700" padding-bottom="12px">
          New access request
        </mj-text>
        <mj-text padding-bottom="14px">
          <strong>${esc(data.requesterName)}</strong> (${esc(data.requesterEmail)})
          has requested access to <strong>${esc(data.scopeLabel)}</strong> in
          <strong>${esc(data.orgName)}</strong>.
        </mj-text>
        ${data.message ? `
        <mj-text padding-bottom="14px" css-class="muted">
          "${esc(data.message)}"
        </mj-text>` : ''}
        <mj-button href="${esc(data.reviewUrl)}">Review request</mj-button>
        <mj-text padding-top="20px" css-class="muted">
          Approve to grant access and assign a role, or reject the request.
        </mj-text>
      </mj-column>
    </mj-section>
  `, { previewText: `${data.requesterName} wants access to ${data.scopeLabel}.` });
  const text = [
    `${data.requesterName} (${data.requesterEmail}) requested access to ${data.scopeLabel} in ${data.orgName}.`,
    data.message ? `\nMessage: "${data.message}"` : '',
    ``,
    `Review: ${data.reviewUrl}`,
  ].join('\n');
  return { subject, mjml, text };
}

export interface EmailVerificationData {
  userName: string;
  verifyUrl: string;
}
export function emailVerification({ brand, data }: TemplateContext<EmailVerificationData>): { subject: string; mjml: string; text: string } {
  const subject = `Verify your email for ${brand.appName}`;
  const mjml = renderLayout(brand, `
    <mj-section padding="32px 24px 16px">
      <mj-column>
        <mj-text font-size="22px" font-weight="700" padding-bottom="12px">
          One last step, ${esc(data.userName)}
        </mj-text>
        <mj-text padding-bottom="14px">
          Click below to verify this email address belongs to you. The link
          expires in 24 hours.
        </mj-text>
        <mj-button href="${esc(data.verifyUrl)}">Verify my email</mj-button>
        <mj-text padding-top="20px" css-class="muted">
          Didn't request this? You can safely ignore the email.
        </mj-text>
      </mj-column>
    </mj-section>
  `);
  const text = `Verify your email: ${data.verifyUrl}`;
  return { subject, mjml, text };
}

export interface PasswordResetData {
  userName: string;
  resetUrl: string;
  expiresInMinutes: number;
}
export function passwordReset({ brand, data }: TemplateContext<PasswordResetData>): { subject: string; mjml: string; text: string } {
  const subject = `Reset your ${brand.appName} password`;
  const mjml = renderLayout(brand, `
    <mj-section padding="32px 24px 16px">
      <mj-column>
        <mj-text font-size="22px" font-weight="700" padding-bottom="12px">
          Password reset for ${esc(data.userName)}
        </mj-text>
        <mj-text padding-bottom="14px">
          Click below to set a new password. This link expires in
          <strong>${data.expiresInMinutes} minutes</strong>.
        </mj-text>
        <mj-button href="${esc(data.resetUrl)}">Reset password</mj-button>
        <mj-text padding-top="20px" css-class="muted">
          If you didn't request this, ignore this email — your password
          stays the same.
        </mj-text>
      </mj-column>
    </mj-section>
  `);
  const text = `Reset your password: ${data.resetUrl} (expires in ${data.expiresInMinutes} minutes)`;
  return { subject, mjml, text };
}

export interface ReportGeneratedData {
  recipientName?: string;
  reportTitle: string;
  projectName: string;
  generatedBy: string;
  passRate: number;
  totalRuns: number;
  passed: number;
  failed: number;
  /** When attachment isn't sent, link to view in app instead. */
  viewUrl?: string;
}
export function reportGenerated({ brand, data }: TemplateContext<ReportGeneratedData>): { subject: string; mjml: string; text: string } {
  const subject = `Report ready: ${data.reportTitle}`;
  const greeting = data.recipientName ? `Hi ${esc(data.recipientName)},` : 'Hi there,';
  const mjml = renderLayout(brand, `
    <mj-section padding="32px 24px 16px">
      <mj-column>
        <mj-text font-size="22px" font-weight="700" padding-bottom="12px">
          ${esc(data.reportTitle)}
        </mj-text>
        <mj-text padding-bottom="14px">
          ${greeting} the latest progress report for
          <strong>${esc(data.projectName)}</strong> is attached as a PDF.
          Generated by ${esc(data.generatedBy)}.
        </mj-text>

        <mj-text padding-bottom="6px"><strong>At a glance:</strong></mj-text>
        <mj-text padding-bottom="12px">
          ${data.passed}/${data.totalRuns} passed
          ${data.failed > 0 ? ` · <span style="color:#dc2626">${data.failed} failed</span>` : ''}
          · <strong style="color:${brand.primaryColor}">${data.passRate}% pass rate</strong>
        </mj-text>

        ${data.viewUrl ? `<mj-button href="${esc(data.viewUrl)}">Open in dashboard</mj-button>` : ''}

        <mj-text padding-top="20px" css-class="muted">
          The PDF is attached to this email. Open in any browser or PDF reader.
        </mj-text>
      </mj-column>
    </mj-section>
  `, { previewText: `${data.passRate}% pass rate · ${data.passed} passed / ${data.totalRuns} total.` });
  const text = `${data.reportTitle}\n\n${data.passed}/${data.totalRuns} passed (${data.passRate}% pass rate). PDF attached.${data.viewUrl ? `\n\nOpen: ${data.viewUrl}` : ''}`;
  return { subject, mjml, text };
}

// ─── Sign-off ───────────────────────────────────────────────────────────────
export interface SignoffRequestData {
  recipientName?: string;
  featureName: string;
  moduleName: string;
  environmentName: string;
  projectName: string;
  passRate: number;
  passed: number;
  total: number;
  coApprovers: string[];
  signoffUrl: string;
}
export function signoffRequest({ brand, data }: TemplateContext<SignoffRequestData>): { subject: string; mjml: string; text: string } {
  const subject = `Sign-off needed: ${data.featureName} (${data.environmentName})`;
  const greeting = data.recipientName ? `Hi ${esc(data.recipientName)},` : 'Hi there,';
  const others = data.coApprovers.length
    ? `<mj-text padding-bottom="12px" css-class="muted">Co-approvers: ${data.coApprovers.map(esc).join(', ')}. Every approver must sign before this feature is signed off.</mj-text>`
    : '';
  const mjml = renderLayout(brand, `
    <mj-section padding="32px 24px 16px">
      <mj-column>
        <mj-text font-size="22px" font-weight="700" padding-bottom="12px">Your sign-off is needed</mj-text>
        <mj-text padding-bottom="14px">
          ${greeting} <strong>${esc(data.featureName)}</strong> (module ${esc(data.moduleName)})
          has passed <strong>100%</strong> in <strong>${esc(data.environmentName)}</strong> on
          ${esc(data.projectName)} and is ready for your sign-off.
        </mj-text>
        <mj-text padding-bottom="12px">
          ${data.passed}/${data.total} passed
          · <strong style="color:${brand.primaryColor}">${data.passRate}% pass rate</strong>
        </mj-text>
        <mj-button href="${esc(data.signoffUrl)}">Review &amp; sign off</mj-button>
        ${others}
      </mj-column>
    </mj-section>
  `, { previewText: `${esc(data.featureName)} passed 100% in ${esc(data.environmentName)} — your sign-off is needed.` });
  const text = `Your sign-off is needed.\n\n${data.featureName} (${data.moduleName}) passed 100% in ${data.environmentName} on ${data.projectName}.\n${data.passed}/${data.total} passed (${data.passRate}%).\n\nReview & sign off: ${data.signoffUrl}`;
  return { subject, mjml, text };
}

export interface SignoffCompletedData {
  recipientName?: string;
  scopeLabel: string;
  environmentName: string;
  projectName: string;
  byWhom: string;
  url: string;
  isModule?: boolean;
}
export function signoffCompleted({ brand, data }: TemplateContext<SignoffCompletedData>): { subject: string; mjml: string; text: string } {
  const subject = `${data.isModule ? 'Module' : 'Feature'} signed off: ${data.scopeLabel} (${data.environmentName})`;
  const greeting = data.recipientName ? `Hi ${esc(data.recipientName)},` : 'Hi there,';
  const mjml = renderLayout(brand, `
    <mj-section padding="32px 24px 16px">
      <mj-column>
        <mj-text font-size="22px" font-weight="700" padding-bottom="12px">✓ Signed off</mj-text>
        <mj-text padding-bottom="14px">
          ${greeting} <strong>${esc(data.scopeLabel)}</strong> has been signed off in
          <strong>${esc(data.environmentName)}</strong> (${esc(data.projectName)}) by ${esc(data.byWhom)}.
        </mj-text>
        <mj-button href="${esc(data.url)}">View sign-off</mj-button>
      </mj-column>
    </mj-section>
  `, { previewText: `${esc(data.scopeLabel)} signed off in ${esc(data.environmentName)}.` });
  const text = `${data.scopeLabel} signed off in ${data.environmentName} (${data.projectName}) by ${data.byWhom}.\n\nView: ${data.url}`;
  return { subject, mjml, text };
}

// ─── Render helper ─────────────────────────────────────────────────────────

/**
 * Compile an MJML template result into the final EmailMessage shape.
 *
 * MJML 5 is ASYNC — it returns a Promise. Treating it as sync silently
 * leaves us with `html: undefined` (Promise stringified to `{}`), which
 * is what was breaking every email since the v5 upgrade. Always await
 * the result.
 *
 * Cost: ~30–80 ms per render. Fine for transactional sends; cache the
 * compiled HTML if you ever need bulk marketing performance.
 */
export async function renderMjml(template: { subject: string; mjml: string; text: string }): Promise<RenderResult> {
  const compiled = await mjml2html(template.mjml, { validationLevel: 'soft' });
  if (Array.isArray(compiled.errors) && compiled.errors.length > 0) {
    // "soft" validation lets the HTML render with warnings. Surface them in
    // the log so issues are obvious without breaking sends.
    console.warn('[email] MJML validation warnings:', compiled.errors.map(e => e.formattedMessage).join('; '));
  }
  return { subject: template.subject, html: compiled.html ?? '', text: template.text };
}

function esc(s: string | undefined): string {
  if (!s) return '';
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
