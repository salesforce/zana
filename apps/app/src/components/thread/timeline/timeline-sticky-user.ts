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
    turn: prompt.parentElement as HTMLElement | null
  }));

  // Fast O(1) lookup from either prompt or turn element back to its item
  const itemByTarget = new Map<HTMLElement, (typeof items)[number]>();
  for (const item of items) {
    itemByTarget.set(item.prompt, item);
    if (item.turn) itemByTarget.set(item.turn, item);
  }

  let cachedPaneHeight = pane.clientHeight;

  const evaluateItem = (item: (typeof items)[number], paneHeight: number, maxHeight: number) => {
    const height = item.prompt.offsetHeight;
    if (height <= 0 || height > maxHeight) {
      if (item.prompt.hasAttribute('data-sticky-prompt')) {
        item.prompt.removeAttribute('data-sticky-prompt');
      }
      return;
    }
    const replyHeight = item.turn ? Math.max(0, item.turn.offsetHeight - height) : 0;
    const shouldPin = !promptOverlapsReply(height, replyHeight, paneHeight);
    if (item.prompt.hasAttribute('data-sticky-prompt') !== shouldPin) {
      item.prompt.toggleAttribute('data-sticky-prompt', shouldPin);
    }
  };

  const updateAll = () => {
    cachedPaneHeight = pane.clientHeight;
    const maxHeight = cachedPaneHeight / 2;
    // Pass 1: measure layout properties in batch without DOM mutation to avoid layout thrashing
    const fits = items.map(({ prompt, turn }) => {
      const height = prompt.offsetHeight;
      if (height <= 0 || height > maxHeight) return false;
      const replyHeight = turn ? Math.max(0, turn.offsetHeight - height) : 0;
      return !promptOverlapsReply(height, replyHeight, cachedPaneHeight);
    });
    // Pass 2: apply DOM attribute updates only when the state changes
    prompts.forEach((prompt, index) => {
      const shouldPin = fits[index]!;
      if (prompt.hasAttribute('data-sticky-prompt') !== shouldPin) {
        prompt.toggleAttribute('data-sticky-prompt', shouldPin);
      }
    });
  };

  // When individual replies stream or expand, re-evaluate only the affected turn
  // in O(1) rather than re-measuring all historical turns on every streamed frame.
  const onResize: ResizeObserverCallback = (entries) => {
    if (!entries || entries.length === 0) {
      updateAll();
      return;
    }
    let paneResized = false;
    const dirtyItems = new Set<(typeof items)[number]>();
    for (const entry of entries) {
      if (entry.target === pane) {
        paneResized = true;
        break;
      }
      const item = itemByTarget.get(entry.target as HTMLElement);
      if (item) dirtyItems.add(item);
    }
    if (paneResized) {
      updateAll();
      return;
    }
    const maxHeight = cachedPaneHeight / 2;
    for (const item of dirtyItems) {
      evaluateItem(item, cachedPaneHeight, maxHeight);
    }
  };

  const observer = new ResizeObserver(onResize);
  observer.observe(pane);
  for (const { prompt, turn } of items) {
    observer.observe(prompt);
    if (turn) observer.observe(turn);
  }
  // Measure before paint, then re-evaluate on expansion, image load, or resize.
  updateAll();
  return () => {
    observer.disconnect();
    for (const prompt of prompts) prompt.removeAttribute('data-sticky-prompt');
  };
}
