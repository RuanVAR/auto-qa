/**
 * syncPhaseStatus — push a platform phase transition to the linked external ticket.
 *
 * Best-effort: failures are logged + surfaced in TicketLink.lastOutboundSyncError
 * but never block the platform-side phase transition.
 */
export type SyncPhaseStatusInput = {
  ticketLinkId: string;
  externalId: string;                          // for plugin convenience — matches TicketLink.externalId
  /** The platform phase value the feature just entered (e.g. "UAT", "Done"). */
  newPhase: string;
  /** Pre-resolved external status from PluginStatusMapping (OUTBOUND row). */
  targetExternalStatus: string;
};

export type SyncPhaseStatusOutput = {
  externalStatus: string;                      // confirmed status after the write
  syncedAt: string;                            // ISO timestamp
};
