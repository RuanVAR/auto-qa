import type { NotificationType } from '@prisma/client';

export interface ChannelPrefs {
  inApp: boolean;
  email: boolean;
}

export const NOTIFICATION_DEFAULTS: Partial<Record<NotificationType, ChannelPrefs>> = {
  ISSUE_MENTIONED:      { inApp: true, email: false },
  TEST_FAILURE_MENTIONED: { inApp: true, email: false },
  ISSUE_ASSIGNED:       { inApp: true, email: true },
  ISSUE_STATUS_CHANGED: { inApp: true, email: false },
  FEATURE_RUN_FAILED:   { inApp: true, email: true },
  FEATURE_RUN_PASSED:   { inApp: true, email: false },
  CODE_INDEX_READY:     { inApp: true, email: false },
  CODE_INDEX_FAILED:    { inApp: true, email: true },
};

export function resolveChannels(
  userPrefs: Record<string, ChannelPrefs>,
  type: NotificationType,
): ChannelPrefs {
  const defaults: ChannelPrefs = NOTIFICATION_DEFAULTS[type] ?? { inApp: true, email: false };
  const override = userPrefs[type as string] as ChannelPrefs | undefined;
  return { ...defaults, ...override };
}
