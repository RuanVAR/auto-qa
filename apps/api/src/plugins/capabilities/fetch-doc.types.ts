/**
 * fetchDoc — fetch the full markdown body of an external doc.
 *
 * Cached in DocLink.cachedMarkdown for 24h by default; refresh button forces
 * a re-fetch. Plugins SHOULD return markdown — HTML must be normalised.
 */
export type FetchDocInput = {
  externalId: string;
};

export type FetchDocOutput = {
  externalId: string;
  externalUrl: string;
  title: string;
  markdown: string;
  updatedAt: string;
};
