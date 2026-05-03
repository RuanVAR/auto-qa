import type { Branding } from '../branding';

/**
 * Shared MJML layout used by every email. Returns a function (body, opts) →
 * MJML string. Body is the raw MJML <mj-section>... fragments specific to
 * the email; this layout supplies the header, footer, and body wrapper.
 *
 * Kept as a TS function rather than an .mjml file because MJML's includes
 * can't easily inject dynamic branding values without a preprocessor — and
 * we don't want to ship one. Plain string interpolation is fine here.
 */
export function renderLayout(brand: Branding, body: string, opts?: { previewText?: string }): string {
  const logoBlock = brand.logoUrl
    ? `<mj-image src="${brand.logoUrl}" alt="${escape(brand.appName)}" width="40px" align="left" padding="0" />`
    : `<mj-text padding="0" font-size="28px" font-weight="700" color="${brand.primaryColor}" line-height="1">${escape(brand.logoFallback)}</mj-text>`;

  return `<mjml>
  <mj-head>
    <mj-title>${escape(brand.appName)}</mj-title>
    ${opts?.previewText ? `<mj-preview>${escape(opts.previewText)}</mj-preview>` : ''}
    <mj-attributes>
      <mj-all font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" />
      <mj-text color="${brand.textColor}" font-size="14px" line-height="1.55" />
      <mj-button background-color="${brand.primaryColor}" color="#ffffff" font-weight="600" border-radius="8px" padding="14px 24px" />
      <mj-section background-color="#ffffff" />
    </mj-attributes>
    <mj-style>
      a { color: ${brand.primaryColor}; }
      .muted { color: ${brand.mutedTextColor}; font-size: 12px; }
      .codeblock {
        background: ${brand.backgroundColor};
        padding: 12px 14px;
        border-radius: 8px;
        font-family: 'SF Mono', Monaco, monospace;
        font-size: 12.5px;
        word-break: break-all;
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="${brand.backgroundColor}" width="600px">

    <!-- Branded header -->
    <mj-section padding="24px 24px 16px" border-bottom="3px solid ${brand.primaryColor}">
      <mj-column width="60px" vertical-align="middle">
        ${logoBlock}
      </mj-column>
      <mj-column vertical-align="middle">
        <mj-text padding="0" font-size="13px" font-weight="700" color="${brand.primaryColor}" letter-spacing="0.5px" text-transform="uppercase">${escape(brand.appName)}</mj-text>
        <mj-text padding="2px 0 0" font-size="11px" color="${brand.mutedTextColor}">${escape(brand.tagline)}</mj-text>
      </mj-column>
    </mj-section>

    <!-- Body -->
    ${body}

    <!-- Footer -->
    <mj-section padding="20px 24px" background-color="${brand.backgroundColor}">
      <mj-column>
        <mj-text padding="0" css-class="muted">
          You're receiving this from ${escape(brand.appName)}. Need help? <a href="mailto:${escape(brand.supportEmail)}">${escape(brand.supportEmail)}</a>
        </mj-text>
        <mj-text padding="6px 0 0" css-class="muted">
          &copy; ${new Date().getFullYear()} ${escape(brand.appName)}
        </mj-text>
      </mj-column>
    </mj-section>

  </mj-body>
</mjml>`;
}

function escape(s: string | undefined): string {
  if (!s) return '';
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
