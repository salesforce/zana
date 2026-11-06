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
 * A pinned prompt at top: 0 paints over the reply when the turn is too tall
 * to fit in the viewport, but the reply is not tall enough to scroll clear
 * of the prompt.
 */
function promptOverlapsReply(promptHeight: number, replyHeight: number, paneHeight: number): boolean {
  return (
    replyHeight > 0 &&
    replyHeight <= paneHeight + promptHeight &&
    promptHeight + replyHeight > paneHeight
  );
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

  const turns = Array.from(
    new Set(items.map((item) => item.turn).filter((turn): turn is HTMLElement => turn !== null))
  );

  const update = () => {
    const paneHeight = pane.clientHeight;
    const maxHeight = paneHeight / 2;
    // Pass 1: measure layout properties in batch without DOM mutation to avoid layout thrashing
    const fits = items.map(({ prompt, turn }) => {
      const height = prompt.offsetHeight;
      if (height <= 0 || height > maxHeight) return false;
      const replyHeight = turn ? Math.max(0, turn.offsetHeight - height) : 0;
      return !promptOverlapsReply(height, replyHeight, paneHeight);
    });
    // Pass 2: apply DOM attribute updates only when the state changes
    prompts.forEach((prompt, index) => {
      const shouldPin = fits[index]!;
      if (prompt.hasAttribute('data-sticky-prompt') !== shouldPin) {
        prompt.toggleAttribute('data-sticky-prompt', shouldPin);
      }
    });
  };

  const observer = new ResizeObserver(update);
  observer.observe(pane);
  for (const prompt of prompts) observer.observe(prompt);
  // Only the active/latest turn resizes dynamically as a reply streams in.
  const activeTurn = turns[turns.length - 1];
  if (activeTurn) observer.observe(activeTurn);
  // Measure before paint, then re-evaluate on expansion, image load, or resize.
  update();
  return () => {
    observer.disconnect();
    for (const prompt of prompts) prompt.removeAttribute('data-sticky-prompt');
  };
}
