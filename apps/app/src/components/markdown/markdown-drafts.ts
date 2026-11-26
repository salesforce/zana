export interface MarkdownDraft { content: string; draft: string; sha256?: string }
// Renderer-session recovery across panel/tab remounts. Never written to shared storage.
const drafts = new Map<string, MarkdownDraft>();
const MAX_DRAFTS = 32;
const MAX_BYTES = 8 * 1024 * 1024;
export function rememberMarkdownDraft(identity: string, draft: MarkdownDraft): void {
  drafts.delete(identity);
  if (draft.content === draft.draft) return;
  drafts.set(identity, draft);
  let bytes = [...drafts.values()].reduce((sum, item) => sum + (item.content.length + item.draft.length) * 2, 0);
  while (drafts.size > MAX_DRAFTS || bytes > MAX_BYTES) {
    const first = drafts.entries().next().value;
    if (!first) break;
    bytes -= (first[1].content.length + first[1].draft.length) * 2;
    drafts.delete(first[0]);
  }
}
export function recallMarkdownDraft(identity: string): MarkdownDraft | undefined { return drafts.get(identity); }
