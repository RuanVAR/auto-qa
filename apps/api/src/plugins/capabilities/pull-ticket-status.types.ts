/**
 * pullTicketStatus — fetch current external status (lean, no description body).
 *
 * Used by the InboundSyncService refresh button + bulk-sync cron + post-webhook
 * confirmation. Plugin returns just enough to update the TicketLink snapshot.
 */
export type PullTicketStatusInput = {
  externalId: string;
};

export type PullTicketStatusOutput = {
  externalId: string;
  externalStatus: string;
  externalStatusColor?: string;
  externalStatusType?: 'open' | 'custom' | 'closed' | string;
  externalAssignees?: { externalId: string; displayName: string; avatarUrl?: string }[];
  externalLastUpdatedAt: string;               // ISO timestamp
};
