export const NEAR_BOTTOM_PX = 64;
export const THREAD_SCROLLBAR_IDLE_MS = 600;

type TransientScrollbarHost = {
  dataset: { scrollbarScrolling?: string };
  removeAttribute(name: string): void;
};

export function markTransientScrollbarScrolling(
  scrollArea: TransientScrollbarHost,
  idleTimeout: { current: ReturnType<typeof setTimeout> | null },
  delayMs = THREAD_SCROLLBAR_IDLE_MS
): void {
  scrollArea.dataset.scrollbarScrolling = 'true';
  if (idleTimeout.current !== null) clearTimeout(idleTimeout.current);
  idleTimeout.current = setTimeout(() => {
    idleTimeout.current = null;
    scrollArea.removeAttribute('data-scrollbar-scrolling');
  }, delayMs);
}

export function clearTransientScrollbarScrolling(
  scrollArea: TransientScrollbarHost | null,
  idleTimeout: { current: ReturnType<typeof setTimeout> | null }
): void {
  if (idleTimeout.current !== null) {
    clearTimeout(idleTimeout.current);
    idleTimeout.current = null;
  }
  scrollArea?.removeAttribute('data-scrollbar-scrolling');
}

export function isNearBottom(
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
  threshold = NEAR_BOTTOM_PX
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

export function shouldStickToBottom(opts: {
  isBusy: boolean;
  streaming?: boolean;
  userPinnedAway: boolean;
}): boolean {
  return (opts.isBusy || Boolean(opts.streaming)) && !opts.userPinnedAway;
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
