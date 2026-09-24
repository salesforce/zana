import { join } from 'node:path';
import type { HarnessHistoryAdapter } from '@zcc/harness-sdk';
import { NativeConversationIndex, boundedTranscript, contentText, jsonLines, type NativeHistoryFormat } from '../../native-conversation-index.js';

export function codexHistoryFormat(home: string): NativeHistoryFormat {
  const root = join(home, '.codex', 'sessions');
  return {
    id: 'codex', root, globalScan: true,
    directories: () => [root],
    descend: (name, depth) => depth < 3 && /^\d{2,4}$/.test(name),
    metadata: (rows) => {
      const meta = rows.find((row) => row.type === 'session_meta')?.payload;
      return typeof meta?.id === 'string' && typeof meta?.cwd === 'string' ? { id: meta.id, cwd: meta.cwd } : undefined;
    },
    parse: (text) => {
      const rows = jsonLines(text);
      const userEvents = rows.some((row) => row.type === 'event_msg' && row.payload?.type === 'user_message');
      return boundedTranscript(rows.flatMap((row) => {
        const message = userEvents && row.type === 'event_msg' && row.payload?.type === 'user_message'
          ? { role: 'user', content: row.payload.message }
          : row.type === 'response_item' && row.payload?.type === 'message' && (!userEvents || row.payload.role !== 'user') ? row.payload : null;
        if (!message || !['user', 'assistant'].includes(message.role)) return [];
        const body = contentText(message.content);
        if (message.role === 'user' && /^(?:<environment_context>|# AGENTS\.md instructions)/.test(body.trim())) return [];
        return [{ role: message.role, text: body }];
      }));
    }
  };
}

export function createCodexHistory({ home, dataDir }: { home: string; dataDir: string }): HarnessHistoryAdapter {
  const index = new NativeConversationIndex(codexHistoryFormat(home), join(dataDir, 'history-index', 'codex.json'));
  return {
    list: ({ projectPath, limit, signal }) => index.list(projectPath, limit, signal),
    validateConversation: ({ projectPath, id }) => index.validate(projectPath, id),
    readTranscript: ({ projectPath, id }) => index.transcript(projectPath, id)
  };
}
