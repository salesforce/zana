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
