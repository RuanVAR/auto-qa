/**
 * listDocs — paginated catalogue of available external docs for binding pickers.
 *
 * Used by the doc-link drawer typeahead + the AI generation flow when asking
 * "which spec doc applies to this feature?".
 */
export type ListDocsInput = {
  query?: string;
  limit?: number;                              // default 25
  cursor?: string;                             // opaque pagination token
};

export type ListDocsOutput = {
  items: {
    externalId: string;
    externalUrl: string;
    title: string;
    summary?: string;
    updatedAt?: string;
    /**
     * Set when this item represents a specific PAGE inside the doc (rather
     * than the doc as a whole). The frontend can pre-select this pageId
     * when the user picks the result, skipping the page-picker step.
     */
    pageId?: string;
  }[];
  nextCursor?: string;
};
