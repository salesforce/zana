import type { ReasoningLevel } from '@zana-ai/zcc-domain/thread-runtime';

export const REASONING_LABELS: Record<ReasoningLevel, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-High',
  ultracode: 'Ultracode',
  max: 'Max',
  ultra: 'Ultra'
};

/** Filled bars on the compact thinking trigger (0–3). */
export function reasoningEffortFill(level: ReasoningLevel): 0 | 1 | 2 | 3 {
  if (level === 'none') return 0;
  if (level === 'low') return 1;
  if (level === 'medium') return 2;
  return 3;
}

export function thinkingEffortTitle(level: ReasoningLevel): string {
  return `Thinking: ${REASONING_LABELS[level]}`;
}

const HIDDEN_COMPOSER_REASONING_LEVELS = new Set<ReasoningLevel>(['ultracode', 'max']);

export function isComposerHiddenReasoningLevel(level: ReasoningLevel): boolean {
  return HIDDEN_COMPOSER_REASONING_LEVELS.has(level);
}

export function visibleComposerReasoningLevels(
  levels: readonly ReasoningLevel[]
): ReasoningLevel[] {
  return levels.filter((level) => !isComposerHiddenReasoningLevel(level));
}

/** Next thinking step, wrapping from the last visible level back to the first. */
export function nextComposerReasoningLevel(
  levels: readonly ReasoningLevel[],
  current: ReasoningLevel
): ReasoningLevel {
  const visible = visibleComposerReasoningLevels(levels);
  if (visible.length === 0) return current;
  const currentVisible = isComposerHiddenReasoningLevel(current)
    ? (visible[visible.length - 1] ?? current)
    : current;
  const index = visible.indexOf(currentVisible);
  return visible[(index + 1) % visible.length] ?? visible[0]!;
}
