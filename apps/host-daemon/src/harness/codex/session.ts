import type { HarnessTranscriptAdapter, TranscriptSessionRef } from '../session-adapter.js';
import { CodexSessionResolver } from './session-resolver.js';
import { readLastAssistantTextCodex, readSessionDigestCodex, readSessionStatsCodex } from './transcript-reader.js';

export class CodexTranscriptAdapter implements HarnessTranscriptAdapter {
  readonly supportsExactResume = true;
  readonly supportsTranscript = true;
  private readonly resolver = new CodexSessionResolver();

  async resolve(session: TranscriptSessionRef) {
    const match = await this.resolver.resolve(
      session.id,
      session.cwd,
      session.createdAt ?? 0,
      session.codexSessionId
    );
    return match ? { id: session.id, nativeId: match.sessionId } : undefined;
  }

  async readLastTurn(session: TranscriptSessionRef): Promise<string> {
    const path = await this.pathFor(session);
    return path ? readLastAssistantTextCodex(path) : '';
  }

  async readDigest(session: TranscriptSessionRef): Promise<string> {
    const path = await this.pathFor(session);
    return path ? readSessionDigestCodex(path) : '';
  }

  async readStats(session: TranscriptSessionRef) {
    const path = await this.pathFor(session);
    return path ? readSessionStatsCodex(path) : null;
  }

  forget(sessionId: string): void {
    this.resolver.forget(sessionId);
  }

  private async pathFor(session: TranscriptSessionRef): Promise<string | null> {
    const match = await this.resolver.resolve(
      session.id,
      session.cwd,
      session.createdAt ?? 0,
      session.codexSessionId
    );
    return match?.rolloutPath ?? null;
  }
}
