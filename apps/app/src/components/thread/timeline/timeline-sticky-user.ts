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

interface StickyPromptItem {
  prompt: HTMLElement;
  turn: HTMLElement | null;
}

/**
 * Sum the heights of non-prompt rows in the turn directly.
 * Excludes inter-row margin/gap and other prompt rows so spacing
 * does not distort the overlap calculation.
 */
function measureReplyHeight(turn: HTMLElement): number {
  let height = 0;
  for (let i = 0; i < turn.children.length; i++) {
    const child = turn.children[i];
    if (child instanceof HTMLElement && !child.classList.contains('is-user')) {
      height += child.offsetHeight;
    }
  }
  return height;
}

function shouldPinPrompt(item: StickyPromptItem, paneHeight: number): boolean {
  const height = item.prompt.offsetHeight;
  if (height <= 0 || height > paneHeight / 2) return false;
  const replyHeight = item.turn ? measureReplyHeight(item.turn) : 0;
  return !promptOverlapsReply(height, replyHeight, paneHeight);
}

function applyPinState(prompt: HTMLElement, shouldPin: boolean): void {
  if (prompt.hasAttribute('data-sticky-prompt') !== shouldPin) {
    prompt.toggleAttribute('data-sticky-prompt', shouldPin);
  }
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

  const items: StickyPromptItem[] = prompts.map((prompt) => ({
    prompt,
    turn: prompt.parentElement as HTMLElement | null
  }));

  // Fast O(1) lookup from either prompt or turn element back to its item(s).
  // A turn can contain multiple prompts if queued/steered turns ever co-locate,
  // so a turn element maps to all items within it.
  const itemsByTarget = new Map<HTMLElement, StickyPromptItem[]>();
  for (const item of items) {
    const promptItems = itemsByTarget.get(item.prompt);
    if (promptItems) {
      promptItems.push(item);
    } else {
      itemsByTarget.set(item.prompt, [item]);
    }
    if (item.turn) {
      const turnItems = itemsByTarget.get(item.turn);
      if (turnItems) {
        turnItems.push(item);
      } else {
        itemsByTarget.set(item.turn, [item]);
      }
    }
  }

  let cachedPaneHeight = pane.clientHeight;

  const updateAll = () => {
    cachedPaneHeight = pane.clientHeight;
    // Pass 1: measure layout properties in batch without DOM mutation to avoid layout thrashing
    const fits = items.map((item) => shouldPinPrompt(item, cachedPaneHeight));
    // Pass 2: apply DOM attribute updates only when the state changes
    items.forEach((item, index) => applyPinState(item.prompt, fits[index]!));
  };

  // When individual replies stream or expand, re-evaluate only the affected turn
  // in O(1) rather than re-measuring all historical turns on every streamed frame.
  const onResize: ResizeObserverCallback = (entries) => {
    if (entries.some((e) => e.target === pane)) {
      updateAll();
      return;
    }

    // Deduplicate affected items across entries
    const affected = new Set<StickyPromptItem>();
    for (const entry of entries) {
      const targetItems = itemsByTarget.get(entry.target as HTMLElement);
      if (targetItems) {
        for (const item of targetItems) {
          affected.add(item);
        }
      }
    }
    if (affected.size === 0) return;

    // Pass 1: measure layout properties in batch without DOM mutation to avoid layout thrashing
    const pendingUpdates: Array<{ prompt: HTMLElement; shouldPin: boolean }> = [];
    for (const item of affected) {
      pendingUpdates.push({
        prompt: item.prompt,
        shouldPin: shouldPinPrompt(item, cachedPaneHeight)
      });
    }

    // Pass 2: apply DOM attribute updates only when the state changes
    for (const { prompt, shouldPin } of pendingUpdates) {
      applyPinState(prompt, shouldPin);
    }
  };

  const observer = new ResizeObserver(onResize);
  observer.observe(pane);
  const observedTurns = new Set<HTMLElement>();
  for (const { prompt, turn } of items) {
    observer.observe(prompt);
    if (turn && !observedTurns.has(turn)) {
      observedTurns.add(turn);
      observer.observe(turn);
    }
  }
  // Measure before paint, then re-evaluate on expansion, image load, or resize.
  updateAll();
  return () => {
    observer.disconnect();
    for (const prompt of prompts) prompt.removeAttribute('data-sticky-prompt');
  };
}
