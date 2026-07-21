/** Push a pre-mapped lifecycle value to an external ticket. */
export type SyncTicketStatusInput = {
  ticketLinkId: string;
  externalId: string;
  platformStatus: string;
  targetExternalStatus: string;
};

export type SyncTicketStatusOutput = {
  externalStatus: string;
  syncedAt: string;
};
