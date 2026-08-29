import type { ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';

/**
 * The message that can still receive text deltas is the trailing assistant
 * leaf of the live frontier. An assistant row followed by later work is
 * complete even while the runtime keeps running.
 */
export function findStreamingAssistantMessageId(
  rows: readonly ThreadTimelineViewRow[]
): string | null {
  let candidateRows: readonly ThreadTimelineViewRow[] = rows;
  for (;;) {
    const lastRow = candidateRows[candidateRows.length - 1];
    if (lastRow === undefined) return null;
    if (lastRow.kind === 'conversation') {
      return lastRow.role === 'assistant' ? lastRow.id : null;
    }
    if (lastRow.kind === 'turn' && lastRow.status === 'pending' && lastRow.children !== null) {
      candidateRows = lastRow.children;
      continue;
    }
    if (lastRow.kind === 'work' && lastRow.workKind === 'delegation' && lastRow.status === 'pending') {
      candidateRows = lastRow.childRows;
      continue;
    }
    return null;
  }
}

export function streamingContentIdentity(
  rows: readonly ThreadTimelineViewRow[],
  streamingId: string | null,
  thinkingUpdatedAt: number | null | undefined
): string {
  if (!streamingId) return `idle:${thinkingUpdatedAt ?? 0}`;
  const text = findConversationText(rows, streamingId);
  return `${streamingId}:${text.length}:${thinkingUpdatedAt ?? 0}`;
}

function findConversationText(
  rows: readonly ThreadTimelineViewRow[],
  id: string
): string {
  for (const row of rows) {
    if (row.kind === 'conversation' && row.id === id) return row.text ?? '';
    if (row.kind === 'turn' && row.children) {
      const nested = findConversationText(row.children, id);
      if (nested !== '') return nested;
    }
    if (row.kind === 'work' && row.workKind === 'delegation') {
      const nested = findConversationText(row.childRows, id);
      if (nested !== '') return nested;
    }
    if (row.kind === 'bundle-summary' || row.kind === 'step-summary') {
      const nested = findConversationText(row.children, id);
      if (nested !== '') return nested;
    }
  }
  return '';
}
