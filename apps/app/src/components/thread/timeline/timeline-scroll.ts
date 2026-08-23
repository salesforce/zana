export const NEAR_BOTTOM_PX = 64;

export function isNearBottom(
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
  threshold = NEAR_BOTTOM_PX
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

export function shouldStickToBottom(opts: {
  isBusy: boolean;
  userPinnedAway: boolean;
}): boolean {
  return opts.isBusy && !opts.userPinnedAway;
}

export function firstUnreadRowId(
  rows: ReadonlyArray<{ id: string; sourceSeqStart?: number; sourceSeqEnd?: number }>,
  lastReadSeq: number | null | undefined
): string | null {
  if (lastReadSeq == null || lastReadSeq <= 0) return null;
  for (const row of rows) {
    const seq = row.sourceSeqStart ?? row.sourceSeqEnd;
    if (typeof seq === 'number' && seq > lastReadSeq) return row.id;
  }
  return null;
}
