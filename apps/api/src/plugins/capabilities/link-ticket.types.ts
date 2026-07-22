/**
 * linkTicket — attach an existing external ticket to a feature/issue/finding.
 *
 * Plugin must verify the ticket exists + return its current title/status so we
 * can populate TicketLink. URL or external ID accepted; the plugin resolves
 * either to a canonical externalId.
 */
export type LinkTicketInput = {
  scope:
    | { kind: 'feature'; featureId: string }
    | { kind: 'module'; moduleId: string }
    | { kind: 'project'; projectId: string }
    | { kind: 'issue'; issueId: string }
    | { kind: 'finding'; findingId: string }
    | { kind: 'defect'; defectId: string };

  /** Either a full URL, a user-entered ticket id, or a ClickUp custom-id. */
  ticketRef: string;
};

export type LinkTicketOutput = {
  externalId: string;
  externalUrl: string;
  externalTitle?: string;
  externalStatus?: string;
  externalStatusColor?: string;
  externalStatusType?: 'open' | 'custom' | 'closed' | string;
};
