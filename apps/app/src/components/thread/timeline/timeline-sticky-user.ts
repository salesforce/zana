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

  const update = () => {
    const maxHeight = pane.clientHeight / 2;
    const fits = prompts.map((prompt) => {
      const height = prompt.offsetHeight;
      return height > 0 && height <= maxHeight;
    });
    prompts.forEach((prompt, index) => prompt.toggleAttribute('data-sticky-prompt', fits[index]));
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
