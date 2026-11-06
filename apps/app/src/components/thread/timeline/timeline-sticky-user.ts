export function isUserConversationRow(row: { kind: string; role?: string }): boolean {
  return row.kind === 'conversation' && row.role === 'user';
}

/** Inclusive-start, exclusive-end ranges: each user prompt plus the rows until the next user prompt. */
export function stickyTurnRanges(
  rows: readonly { kind: string; role?: string }[]
): Array<{ start: number; end: number }> {
  const starts: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (isUserConversationRow(rows[i]!)) starts.push(i);
  }
  return starts.map((start, i) => ({
    start,
    end: i + 1 < starts.length ? starts[i + 1]! : rows.length
  }));
}

/**
 * Pin user prompts that leave at least half the transcript visible for the reply,
 * but unpin them when the transcript is shortened (e.g. composer expansion) and
 * cannot accommodate the turn without overlapping the reply.
 */
export function observeStickyUserPrompts(pane: HTMLElement): () => void {
  const prompts = Array.from(pane.querySelectorAll<HTMLElement>(
    '.thread-timeline-current-turn > .thread-timeline-item.is-user'
  ));
  if (prompts.length === 0 || typeof ResizeObserver === 'undefined') return () => {};

  const items = prompts.map((prompt) => ({
    prompt,
    turn: prompt.closest<HTMLElement>('.thread-timeline-current-turn')
  }));

  const update = () => {
    const paneHeight = pane.clientHeight;
    const maxHeight = paneHeight / 2;
    // Pass 1: measure layout properties in batch without DOM mutation to avoid layout thrashing
    const fits = items.map(({ prompt, turn }) => {
      const height = prompt.offsetHeight;
      if (height <= 0 || height > maxHeight) return false;
      const replyHeight = turn ? Math.max(0, turn.offsetHeight - height) : 0;
      // When a reply exists and is not tall enough to scroll fully clear of the
      // pinned prompt (replyHeight <= paneHeight + height), the prompt may only
      // pin if the entire turn fits in the pane without needing to scroll.
      // Otherwise, scrolling to the bottom of the turn causes the pinned prompt
      // to paint over the top of the reply.
      const overlaps =
        replyHeight > 0 &&
        replyHeight <= paneHeight + height &&
        height + replyHeight > paneHeight;
      return !overlaps;
    });
    // Pass 2: apply DOM attribute updates in batch
    prompts.forEach((prompt, index) => {
      prompt.toggleAttribute('data-sticky-prompt', fits[index]);
    });
  };

  const observer = new ResizeObserver(update);
  observer.observe(pane);
  for (const prompt of prompts) observer.observe(prompt);
  // Measure before paint, then re-evaluate on expansion, image load, or resize.
  update();
  return () => {
    observer.disconnect();
    for (const prompt of prompts) prompt.removeAttribute('data-sticky-prompt');
  };
}
