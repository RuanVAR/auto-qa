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
  /** The list/board the task lives in — needed to enumerate the valid
   *  statuses a caller can transition the task to. */
  externalListId?: string;
  /** Custom fields with their current values — lets a caller inherit a
   *  feature task's fields (incl. epic, when modelled as a field) onto a
   *  bug task created from it. */
  externalCustomFields?: { id: string; name: string; type: string; value?: unknown }[];
  externalAssignees?: { externalId: string; displayName: string; avatarUrl?: string }[];
  externalLastUpdatedAt: string;               // ISO timestamp
};
