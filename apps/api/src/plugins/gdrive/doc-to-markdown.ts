// The API tsconfig has no esModuleInterop, so a default `import x from 'cjs'`
// resolves to `x.default` (undefined) at runtime. These libs are CommonJS
// (module.exports = …), so use `import = require` to get the real export.
import TurndownService = require('turndown');
import mammoth = require('mammoth');
// turndown-plugin-gfm ships no types — adds tables/strikethrough/task-list support.
const { gfm } = require('turndown-plugin-gfm');

/**
 * Clean up doc HTML before markdown conversion:
 *  - drop embedded images (often huge base64 data URIs — useless in a description)
 *  - promote whole-paragraph bold runs to headings, so docs that fake headings
 *    with bold text (instead of Word heading styles) still split into sections.
 */
function preprocessHtml(html: string): string {
  return (html ?? '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<p>\s*<strong>([\s\S]*?)<\/strong>\s*<\/p>/gi, (m, inner) => {
      const text = inner.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim();
      if (!text || text.length > 120) return m; // long → real paragraph, not a heading
      return `<h2>${text}</h2>`;
    });
}

/**
 * Convert HTML to markdown for the description builder. ATX headings (`#`) are
 * required so the markdown slicer (listSections) can split the doc into
 * pickable sections. The gfm plugin keeps tables/strikethrough intact.
 */
export function htmlToMarkdown(html: string): string {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });
  td.use(gfm);
  return td.turndown(preprocessHtml(html)).trim();
}

/**
 * Convert a .docx buffer to markdown. mammoth maps Word heading styles to
 * <h1>…<h6>; preprocessHtml additionally promotes bold-only paragraphs so
 * unstyled docs still yield detectable sections.
 */
export async function docxToMarkdown(buffer: Buffer): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  return htmlToMarkdown(html);
}
