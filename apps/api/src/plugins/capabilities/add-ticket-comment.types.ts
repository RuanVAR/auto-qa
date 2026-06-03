/** Post a free-text comment onto an external tracker ticket. */
export type AddTicketCommentInput = {
  /** External task/ticket id. */
  externalId: string;
  /** Comment body (plain text / markdown). */
  comment: string;
  /** Resolved @mentions to tag in the comment so the user is notified. The
   *  token is the @slug as it appears in `comment` (without the leading @). */
  mentions?: { externalUserId: number; token: string }[];
};

export type AddTicketCommentOutput = {
  ok: true;
  commentId?: string;
};
