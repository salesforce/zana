import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import type { HarnessHistoryAdapter, HarnessHistoryConversation } from '@zcc/harness-sdk';
import { NATIVE_HISTORY_ID, boundedTranscript, jsonLines, windowText } from '../../native-conversation-index.js';
import { nativeDirectories, nativeJson, nativePath } from '../history-files.js';

/** Grok's installed session contract: summary identity + authoritative ACP updates.jsonl. */
export function createGrokHistory({ home }: { home: string }): HarnessHistoryAdapter {
  const root = join(home, '.grok', 'sessions');
  async function groups(projectPath: string, signal: AbortSignal) {
    const cwd = await realpath(projectPath);
    const encoded = [...new Set([cwd, projectPath].map(encodeURIComponent))];
    if (encoded.every((name) => Buffer.byteLength(name) <= 255)) return encoded;
    const found: string[] = [];
    for (const name of await nativeDirectories(root, root, signal)) {
      try {
        const path = await nativePath(root, join(root, name, '.cwd'));
        const data = await windowText(path, 16_384);
        if (data.size <= 16_384 && await realpath(data.text.trim()) === cwd) found.push(name);
      } catch { /* An unrelated group cannot grant project membership. */ }
    }
    return [...new Set([...encoded.filter((name) => Buffer.byteLength(name) <= 255), ...found])];
  }
  async function metadata(projectPath: string, group: string, id: string) {
    if (!NATIVE_HISTORY_ID.test(id)) throw new Error('Invalid native id');
    const folder = await nativePath(root, join(root, group, id));
    const summary = await nativeJson(root, join(folder, 'summary.json'));
    if (summary.info?.id !== id || typeof summary.info?.cwd !== 'string' || await realpath(summary.info.cwd) !== await realpath(projectPath)) throw new Error('Conversation belongs to another project');
    await nativePath(root, join(folder, 'updates.jsonl'));
    return { folder, summary };
  }
  async function resolve(projectPath: string, id: string, signal: AbortSignal) {
    for (const group of await groups(projectPath, signal)) {
      if (signal.aborted) break;
      try { return await metadata(projectPath, group, id); } catch { /* Try the canonical/alias group. */ }
    }
    throw new Error('Native conversation unavailable');
  }
  return {
    async list({ projectPath, limit, signal }) {
      const rows: HarnessHistoryConversation[] = [];
      for (const group of await groups(projectPath, signal)) {
        for (const id of await nativeDirectories(root, join(root, group), signal)) {
          if (signal.aborted || rows.length >= 10_000) break;
          if (!NATIVE_HISTORY_ID.test(id)) continue;
          try {
            const { summary } = await metadata(projectPath, group, id);
            const timestamp = Date.parse(summary.last_active_at || summary.updated_at || summary.created_at);
            rows.push({ id, title: String(summary.title || summary.generated_title || summary.session_summary || 'Untitled conversation').slice(0, 200), lastActiveAt: Number.isFinite(timestamp) ? timestamp : null });
          } catch { /* Keep other intact conversations readable. */ }
        }
      }
      return rows.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)).slice(0, limit);
    },
    async validateConversation({ projectPath, id, signal }) {
      try { await resolve(projectPath, id, signal); return true; } catch { return false; }
    },
    async readTranscript({ projectPath, id, signal }) {
      try {
        const { folder } = await resolve(projectPath, id, signal);
        const body = await windowText(await nativePath(root, join(folder, 'updates.jsonl')), 4 * 1024 * 1024);
        const messages: Array<{ role: 'user' | 'assistant'; text: string }> = [];
        let chunk: (typeof messages)[number] | undefined;
        for (const row of jsonLines(body.text)) {
          if (signal.aborted) throw new Error('Cancelled');
          const update = row.params?.sessionId === id && row.params?.update;
          const role = update?.sessionUpdate === 'user_message_chunk' ? 'user' : update?.sessionUpdate === 'agent_message_chunk' ? 'assistant' : undefined;
          if (!role || update.content?.type !== 'text' || typeof update.content.text !== 'string') { chunk = undefined; continue; }
          if (chunk?.role === role) chunk.text += update.content.text;
          else { chunk = { role, text: update.content.text }; messages.push(chunk); }
        }
        const result = boundedTranscript(messages);
        return { ...result, truncated: result.truncated || body.size > 4 * 1024 * 1024 };
      } catch { return { messages: [], truncated: false, unavailableReason: 'The saved Grok transcript is unavailable or belongs to another project.' }; }
    }
  };
}
