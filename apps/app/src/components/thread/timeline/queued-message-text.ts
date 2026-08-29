export function queuedMessageTextFromUnknown(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') return [];
      if ((part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string') {
        return [(part as { text: string }).text];
      }
      return [];
    })
    .join('\n')
    .trim();
}
