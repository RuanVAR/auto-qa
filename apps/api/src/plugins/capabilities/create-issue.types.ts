/**
 * createIssue — push a new ticket to the external system.
 *
 * Called from StepFailurePanel "Create ticket" and from the IssueTracker
 * "Push to ClickUp/Jira" actions. Returns enough metadata to materialise a
 * TicketLink row.
 */
export type CreateIssueInput = {
  /** Where the issue lives in our model. Exactly one of these set. */
  scope:
    | { kind: 'feature'; featureId: string }
    | { kind: 'module'; moduleId: string }
    | { kind: 'project'; projectId: string }
    | { kind: 'issue'; issueId: string }
    | { kind: 'finding'; findingId: string };

  title: string;
  description?: string;                       // markdown
  severity?: 'low' | 'medium' | 'high' | 'critical';
  labels?: string[];

  /** Optional list of artifact URLs (signed) the plugin can attach if it supports it. */
  artifactUrls?: { url: string; filename: string; contentType?: string }[];

  /**
   * Plugin-specific task-type id, when the target system supports one
   * (ClickUp's `custom_item_id` — Bug / Enhancement / Action Item / etc).
   * Numeric stringified so it survives JSON round-trips through plugin
   * dispatch. Plugins that don't model task type ignore this.
   */
  customItemId?: string;
};

export type CreateIssueOutput = {
  externalId: string;                         // task id, issue key
  externalUrl: string;
  externalTitle?: string;
  externalStatus?: string;
};
