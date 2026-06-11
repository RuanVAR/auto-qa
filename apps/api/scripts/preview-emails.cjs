/**
 * Dev-only: render every email template to static HTML so you can eyeball the
 * branding/layout without sending mail. Writes to apps/web/public/email-preview/
 * (served by the web app), so the logo URL — which points at the web app — also
 * resolves when you open the preview at http://localhost:3000/email-preview/.
 *
 * Run:  docker compose -f docker/dev/docker-compose.yml exec -T api \
 *         node /app/apps/api/scripts/preview-emails.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const T = require('/app/apps/api/dist/email/templates');
const { loadBranding } = require('/app/apps/api/dist/email/branding');

// The env-resolved brand: appName from APP_NAME, logoUrl = the default platform
// asset (or EMAIL_LOGO_URL if set). Mirrors what real sends use as the fallback
// when there's no org/platform-admin logo override.
const brand = loadBranding(process.env);

const U = 'http://localhost:3000';
const samples = {
  welcomePending: [T.welcomePending, { userName: 'Ruan', orgName: 'OpenVantage' }],
  accountApproved: [T.accountApproved, { userName: 'Ruan', loginUrl: `${U}/login`, approverName: 'Platform Admin' }],
  accountRejected: [T.accountRejected, { userName: 'Ruan', reason: 'Email domain not on the allow-list.' }],
  adminApprovalConfirmation: [T.adminApprovalConfirmation, { adminName: 'Admin', approvedUserName: 'Ruan', approvedUserEmail: 'ruan@openvantage.co.za' }],
  memberInvite: [T.memberInvite, { inviterName: 'Ruan', orgName: 'OpenVantage', acceptUrl: `${U}/invite/abc123`, projectAssignmentsSummary: 'MPOWA (QA_ENGINEER, Dev)' }],
  emailVerification: [T.emailVerification, { userName: 'Ruan', verifyUrl: `${U}/verify/abc123` }],
  passwordReset: [T.passwordReset, { userName: 'Ruan', resetUrl: `${U}/reset/abc123` }],
  reportGenerated: [T.reportGenerated, { recipientName: 'Ruan', reportTitle: 'Test Run — Test Run 6', projectName: 'MPOWA', generatedBy: 'Ruan Viljoen', passRate: 67, totalRuns: 3, passed: 2, failed: 1, viewUrl: `${U}/reports/abc123` }],
  signoffRequest: [T.signoffRequest, { recipientName: 'Ruan', featureName: 'Login', moduleName: 'Authentication', environmentName: 'Dev', projectName: 'MPOWA', passRate: 100, passed: 2, total: 2, coApprovers: ['Alice', 'Bob'], signoffUrl: `${U}/signoff/abc123` }],
  signoffCompleted: [T.signoffCompleted, { recipientName: 'Ruan', scopeLabel: 'Login', environmentName: 'Dev', projectName: 'MPOWA', byWhom: 'Ruan Viljoen', url: `${U}/x`, isModule: false }],
};

const outDir = '/app/apps/web/public/email-preview';
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const rows = [];
  for (const [name, [fn, data]] of Object.entries(samples)) {
    const rendered = await T.renderMjml(fn({ brand, data }));
    fs.writeFileSync(path.join(outDir, `${name}.html`), rendered.html);
    rows.push(`<li><a href="/email-preview/${name}.html" target="preview">${name}</a> — <span style="color:#64748b">${rendered.subject}</span></li>`);
  }
  const index = `<!doctype html><meta charset="utf-8"><title>Email previews</title>
<body style="font-family:system-ui,sans-serif;margin:0">
  <div style="display:flex;height:100vh">
    <nav style="width:340px;border-right:1px solid #e2e8f0;padding:18px;overflow:auto">
      <h2 style="margin:0 0 6px">Email previews</h2>
      <p style="font-size:12px;color:#475569;margin:0 0 14px">Brand <b>${brand.appName}</b><br>Logo <code style="font-size:11px">${brand.logoUrl}</code></p>
      <ol style="line-height:1.9;font-size:14px;padding-left:18px">${rows.join('')}</ol>
    </nav>
    <iframe name="preview" style="flex:1;border:0" src="/email-preview/reportGenerated.html"></iframe>
  </div>
</body>`;
  fs.writeFileSync(path.join(outDir, 'index.html'), index);
  console.log(`Wrote ${Object.keys(samples).length} previews → ${outDir}`);
  console.log(`Brand: ${brand.appName} | logo: ${brand.logoUrl}`);
  console.log('Open: http://localhost:3000/email-preview/index.html');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
