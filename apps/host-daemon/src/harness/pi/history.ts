import { join } from 'node:path';
import type { HarnessHistoryAdapter } from '@zcc/harness-sdk';
import { NativeConversationIndex, boundedTranscript, contentText, jsonLines, type NativeHistoryFormat } from '../../native-conversation-index.js';

export function piHistoryFormat(home: string): NativeHistoryFormat {
  const root = join(home, '.pi', 'agent', 'sessions');
  const directory = (cwd: string) => join(root, `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`);
  return {
    id: 'pi', root,
    directories: (cwd, original) => [directory(cwd), directory(original)],
    metadata: (rows) => {
      const header = rows[0];
      return header?.type === 'session' && typeof header.id === 'string' && typeof header.cwd === 'string'
        ? { id: header.id, cwd: header.cwd } : undefined;
    },
    title: (rows) => [...rows].reverse().find((row) => row.type === 'session_info' && typeof row.name === 'string')?.name,
    parse: (text) => {
      const rows = jsonLines(text);
      const entries = rows.filter((row) => row.type !== 'session' && typeof row.id === 'string');
      const byId = new Map(entries.map((row) => [row.id, row]));
      const active = [];
      const seen = new Set<string>();
      let current = entries.at(-1);
      while (current && !seen.has(current.id)) {
        seen.add(current.id); active.push(current); current = byId.get(current.parentId);
      }
      // Legacy v1 sessions predate the branch tree.
      return boundedTranscript((entries.length ? active.reverse() : rows).flatMap((row) => {
        const message = row.type === 'message' && row.message;
        return message && ['user', 'assistant'].includes(message.role) ? [{ role: message.role, text: contentText(message.content) }] : [];
      }));
    }
  };
}

export function createPiHistory({ home, dataDir }: { home: string; dataDir: string }): HarnessHistoryAdapter {
  const index = new NativeConversationIndex(piHistoryFormat(home), join(dataDir, 'history-index', 'pi.json'));
  return {
    list: ({ projectPath, limit, signal }) => index.list(projectPath, limit, signal),
    validateConversation: ({ projectPath, id }) => index.validate(projectPath, id),
    readTranscript: ({ projectPath, id }) => index.transcript(projectPath, id)
  };
}
