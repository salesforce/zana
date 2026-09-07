export function stepPromptHistory(args: {
  key: 'ArrowUp' | 'ArrowDown';
  entries: readonly string[];
  index: number;
  currentText: string;
  draft: string;
}): { index: number; text: string; draft: string } | null {
  if (args.entries.length === 0) return null;
  if (args.key === 'ArrowUp') {
    if (args.index === -1 && args.currentText.trim().length > 0 && args.currentText !== args.entries.at(-1)) {
      const nextIndex = args.entries.length - 1;
      return { index: nextIndex, text: args.entries[nextIndex]!, draft: args.currentText };
    }
    if (args.index === -1) {
      const nextIndex = args.entries.length - 1;
      return { index: nextIndex, text: args.entries[nextIndex]!, draft: args.currentText };
    }
    if (args.index <= 0) return null;
    return { index: args.index - 1, text: args.entries[args.index - 1]!, draft: args.draft };
  }
  if (args.index < 0) return null;
  if (args.index >= args.entries.length - 1) {
    return { index: -1, text: args.draft, draft: args.draft };
  }
  return { index: args.index + 1, text: args.entries[args.index + 1]!, draft: args.draft };
}

export function promptHistoryTexts(entries: ReadonlyArray<{ input?: unknown }>): string[] {
  return entries.flatMap((entry) => {
    if (!Array.isArray(entry.input)) return [];
    const text = entry.input
      .flatMap((part) => {
        if (!part || typeof part !== 'object') return [];
        if ((part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string') {
          return [(part as { text: string }).text];
        }
        return [];
      })
      .join('\n')
      .trim();
    return text ? [text] : [];
  });
}
