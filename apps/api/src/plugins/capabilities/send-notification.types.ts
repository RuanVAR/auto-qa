/**
 * sendNotification — chat-style message capability (Slack-shaped).
 *
 * Mirrors the platform's notification surface: a title, a body, an optional
 * deep-link back into the platform, and severity. Plugin chooses the channel
 * from binding config (e.g. defaultChannelId for Slack).
 */
export type SendNotificationInput = {
  title: string;
  body: string;                                // plain text or simple markdown
  severity?: 'info' | 'warn' | 'error';
  deepLinkUrl?: string;                        // back into the platform
  /** Optional override channel — falls through to binding default if absent. */
  channelOverride?: string;
};

export type SendNotificationOutput = {
  externalMessageId?: string;
  externalChannelId?: string;
  deliveredAt: string;
};
