import { basename, join } from 'node:path';
import type { HarnessHistoryAdapter } from '@zcc/harness-sdk';
import { encodeProjectCwd } from '@zana-ai/zcc-domain/path-encoding';
import { NativeConversationIndex, boundedTranscript, contentText, jsonLines, type NativeHistoryFormat } from '../../native-conversation-index.js';

export function claudeHistoryFormat(home: string): NativeHistoryFormat {
  const root = join(home, '.claude', 'projects');
  return {
    id: 'claude', root,
    directories: (cwd, original) => [join(root, encodeProjectCwd(cwd)), join(root, encodeProjectCwd(original))],
    metadata: (rows, path) => {
      const cwd = rows.find((row) => typeof row.cwd === 'string')?.cwd;
      return cwd ? { id: basename(path, '.jsonl'), cwd } : undefined;
    },
    title: (rows) => [...rows].reverse().find((row) => row.customTitle || row.aiTitle)?.customTitle
      || [...rows].reverse().find((row) => row.aiTitle)?.aiTitle,
    parse: (text) => boundedTranscript(jsonLines(text).flatMap((row) => {
      const message = !row.isMeta && row.message;
      return message && ['user', 'assistant'].includes(message.role) ? [{ role: message.role, text: contentText(message.content) }] : [];
    }))
  };
}

export function createClaudeHistory({ home, dataDir }: { home: string; dataDir: string }): HarnessHistoryAdapter {
  const index = new NativeConversationIndex(claudeHistoryFormat(home), join(dataDir, 'history-index', 'claude.json'));
  return {
    list: ({ projectPath, limit, signal }) => index.list(projectPath, limit, signal),
    validateConversation: ({ projectPath, id }) => index.validate(projectPath, id),
    readTranscript: ({ projectPath, id }) => index.transcript(projectPath, id)
  };
}
