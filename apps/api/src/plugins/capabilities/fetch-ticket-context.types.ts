/**
 * fetchTicketContext — full description + comments for AI prompt building
 * and acceptance-criteria import.
 */
export type FetchTicketContextInput = {
  externalId: string;
  includeComments?: boolean;                   // default true
};

export type FetchTicketContextOutput = {
  externalId: string;
  title: string;
  descriptionMarkdown: string;
  comments?: { author: string; body: string; createdAt: string }[];
  /** Heuristically extracted acceptance criteria (## AC, "AC:" headings, etc.). */
  acceptanceCriteria?: string[];
};
