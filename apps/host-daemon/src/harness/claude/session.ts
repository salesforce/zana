import type { HarnessTranscriptAdapter, TranscriptSessionRef } from '../session-adapter.js';
import { transcriptPath, readLastAssistantText, readSessionDigest, readSessionStats } from './transcript-reader.js';

function pathFor(session: TranscriptSessionRef): string | null {
  return transcriptPath(session.cwd, session.claudeSessionId);
}

export const claudeTranscript: HarnessTranscriptAdapter = {
  supportsExactResume: true,
  supportsTranscript: true,
  resolve: async (session) => session.claudeSessionId ? { id: session.id, nativeId: session.claudeSessionId } : undefined,
  readLastTurn: async (session) => {
    const path = pathFor(session);
    return path ? readLastAssistantText(path) : '';
  },
  readDigest: async (session) => {
    const path = pathFor(session);
    return path ? readSessionDigest(path) : '';
  },
  readStats: async (session) => {
    const path = pathFor(session);
    return path ? readSessionStats(path) : null;
  }
};
