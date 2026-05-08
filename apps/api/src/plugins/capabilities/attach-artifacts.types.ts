/**
 * attachArtifacts — upload screenshots / recordings / logs to an external ticket.
 *
 * Caller passes signed download URLs (resolved by storage provider). Plugin
 * fetches each, applies its own size/type rules, falls back to appending a
 * signed URL to the ticket description when upload fails or hits size cap.
 */
export type AttachArtifactsInput = {
  externalId: string;
  artifacts: {
    url: string;                              // signed download URL
    filename: string;
    contentType?: string;
    sizeBytes?: number;
    kind?: 'screenshot' | 'recording' | 'log' | 'har' | 'trace' | 'other';
  }[];
};

export type AttachArtifactsOutput = {
  uploaded: { filename: string; externalAttachmentId?: string; externalUrl?: string }[];
  fallbackToDescription: { filename: string; reason: string }[];
};
