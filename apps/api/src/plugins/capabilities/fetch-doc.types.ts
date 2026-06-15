/**
 * fetchDoc — fetch the full markdown body of an external doc.
 *
 * Cached in DocLink.cachedMarkdown for 24h by default; refresh button forces
 * a re-fetch. Plugins SHOULD return markdown — HTML must be normalised.
 */
export type FetchDocInput = {
  externalId: string;
  /** Target a specific page within a multi-page doc (ClickUp). Ignored by
   *  sources without pages (Google Drive). */
  pageId?: string;
};

export type FetchDocOutput = {
  externalId: string;
  externalUrl: string;
  title: string;
  /** Rendered body. Markdown by default; exported HTML when contentType='html'. */
  markdown: string;
  updatedAt: string;
  /**
   * How `markdown` should be rendered. Defaults to 'markdown' when omitted
   * (legacy ClickUp behaviour). Google-native docs return 'html' (Drive's
   * export keeps tables/images that markdown would mangle).
   */
  contentType?: 'markdown' | 'html';
};
