import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import type { ConversationTranscript } from '@zana-ai/zcc-domain/product';

/** A bounded text preview of the saved timeline; tools and delegated threads stay in the full view. */
export function threadHistoryTranscript(rows: readonly TimelineRow[], hasOlderRows = false): ConversationTranscript {
  const transcript: ConversationTranscript = { messages: [], truncated: hasOlderRows };
  let remaining = 1_000_000;
  const visit = (entries: readonly TimelineRow[]) => {
    for (const row of entries) {
      if (row.kind === 'turn') { visit(row.children ?? []); continue; }
      if (row.kind !== 'conversation' || !row.text.trim()) continue;
      if (transcript.messages.length >= 500 || remaining <= 0) { transcript.truncated = true; return; }
      const text = row.text.slice(0, Math.min(64_000, remaining));
      transcript.messages.push({ role: row.role, text });
      remaining -= text.length;
      if (text.length < row.text.length) transcript.truncated = true;
    }
  };
  visit(rows);
  return transcript;
}
