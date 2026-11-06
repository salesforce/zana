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

/** Pin only prompts that leave at least half the transcript visible for the reply. */
export function observeStickyUserPrompts(pane: HTMLElement): () => void {
  const prompts = Array.from(pane.querySelectorAll<HTMLElement>(
    '.thread-timeline-current-turn > .thread-timeline-item.is-user'
  ));
  if (prompts.length === 0 || typeof ResizeObserver === 'undefined') return () => {};

  const turns = Array.from(
    new Set(
      prompts
        .map((prompt) => prompt.closest<HTMLElement>('.thread-timeline-current-turn'))
        .filter((turn): turn is HTMLElement => turn !== null)
    )
  );

  const update = () => {
    const maxHeight = pane.clientHeight / 2;
    const fits = prompts.map((prompt) => {
      const height = prompt.offsetHeight;
      if (height <= 0 || height > maxHeight) return false;
      const turn = prompt.closest<HTMLElement>('.thread-timeline-current-turn');
      const replyHeight = turn ? Math.max(0, turn.offsetHeight - height) : 0;
      // When a reply exists and is not tall enough to fill the transcript on
      // its own, the prompt may only pin if the entire turn fits in the pane.
      // Otherwise, scrolling to the reply at the bottom of the turn causes the
      // pinned prompt to cover part of the reply.
      if (replyHeight > 0 && replyHeight <= pane.clientHeight && height + replyHeight > pane.clientHeight) {
        return false;
      }
      return true;
    });
    prompts.forEach((prompt, index) => prompt.toggleAttribute('data-sticky-prompt', fits[index]));
  };
  const observer = new ResizeObserver(update);
  observer.observe(pane);
  for (const prompt of prompts) observer.observe(prompt);
  for (const turn of turns) observer.observe(turn);
  // Measure before paint, then re-evaluate on expansion, image load, or resize.
  update();
  return () => {
    observer.disconnect();
    for (const prompt of prompts) prompt.removeAttribute('data-sticky-prompt');
  };
}
