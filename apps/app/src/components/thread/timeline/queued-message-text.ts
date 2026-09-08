function textPartsFromUnknown(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((part) => {
    if (!part || typeof part !== 'object') return [];
    if ((part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string') {
      return [(part as { text: string }).text];
    }
    return [];
  });
}

export function queuedMessageTextFromUnknown(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as { content?: unknown; input?: unknown };
  const fromContent = textPartsFromUnknown(record.content);
  if (fromContent.length > 0) return fromContent.join('\n').trim();
  return textPartsFromUnknown(record.input).join('\n').trim();
}

export function nextTurnItemText(row: { payload?: string; input?: unknown }): string {
  if (typeof row.payload === 'string') {
    try {
      return queuedMessageTextFromUnknown(JSON.parse(row.payload) as unknown);
    } catch {
      return '';
    }
  }
  return queuedMessageTextFromUnknown({ input: row.input });
}

export function queuedMessagePreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
