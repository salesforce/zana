export function imagePreviewSrc(file: { contentType: string | null; content: string }): string | null {
  if (file.contentType !== 'image/svg+xml') return null;
  return `data:image/svg+xml,${encodeURIComponent(file.content)}`;
}

export function resolveQuestionAnswer(draft: string, prompts: string[]): string {
  return draft.trim() || prompts[0] || '';
}
