import { app } from 'electron';
import { join } from 'node:path';
import type { HarnessTranscriptAdapter, TranscriptSessionRef } from '../session-adapter.js';
import { OpenCodeSessionResolver } from './session-resolver.js';
import {
  readLastAssistantTextOpenCode,
  readSessionDigestOpenCode,
  readSessionStatsOpenCode,
  readSessionStatsOpenCodeExport
} from './transcript-reader.js';

export class OpenCodeTranscriptAdapter implements HarnessTranscriptAdapter {
  readonly supportsExactResume = true;
  readonly supportsTranscript = true;
  private readonly resolver: OpenCodeSessionResolver;

  constructor(private readonly binary: () => string) {
    this.resolver = new OpenCodeSessionResolver({ binary });
  }

  async resolve(session: TranscriptSessionRef) {
    const nativeId = session.openCodeSessionId
      ?? (await this.resolver.resolve(session.id, session.cwd, session.createdAt ?? 0))?.sessionId;
    return nativeId ? { id: session.id, nativeId } : undefined;
  }

  async readLastTurn(session: TranscriptSessionRef, reference?: { nativeId?: string }): Promise<string> {
    const nativeId = reference?.nativeId ?? (await this.resolve(session))?.nativeId;
    return nativeId ? readLastAssistantTextOpenCode(nativeId) : '';
  }

  async readDigest(session: TranscriptSessionRef, reference?: { nativeId?: string }): Promise<string> {
    const nativeId = reference?.nativeId ?? (await this.resolve(session))?.nativeId;
    return nativeId ? readSessionDigestOpenCode(nativeId) : '';
  }

  async readStats(session: TranscriptSessionRef, reference?: { nativeId?: string }) {
    const nativeId = reference?.nativeId ?? (await this.resolve(session))?.nativeId;
    if (!nativeId) return null;
    const dbPath = join(process.env.XDG_DATA_HOME || join(app.getPath('home'), '.local', 'share'), 'opencode', 'opencode.db');
    return (await readSessionStatsOpenCode(nativeId, { dbPath }))
      ?? readSessionStatsOpenCodeExport(nativeId, { binary: this.binary() });
  }

  forget(sessionId: string): void {
    this.resolver.forget(sessionId);
  }
}
