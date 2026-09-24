import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HarnessTranscriptAdapter, TranscriptSessionRef } from '../session-adapter.js';
import { OpenCodeSessionResolver } from './session-resolver.js';
import {
  readLastAssistantTextOpenCode,
  readSessionDigestOpenCode,
  readSessionStatsOpenCode,
  readSessionStatsOpenCodeExport
} from './transcript-reader.js';
import { listRemoteOpenCodeSessions, readSessionStatsOpenCodeRemote } from './remote-exec.js';

/** Same bounded fan-out as the local resolver — newest-first, Rule 5. */
const REMOTE_LIST_LIMIT = 5;

/**
 * Resolve a REMOTE session's `ses_<hex>` id by listing OpenCode sessions on the
 * remote host over ssh and picking the earliest one created at/after this tab's
 * spawn in the tab's cwd — the remote twin of {@link OpenCodeSessionResolver}.
 * Remote directories are compared verbatim (no LOCAL `realpath`, which would
 * fail on a path that only exists on the remote box). Returns null (uncached)
 * until the row appears; never throws.
 */
async function resolveRemoteNativeId(session: TranscriptSessionRef): Promise<string | undefined> {
  if (!session.remote) return undefined;
  // Contract: never throw. `listRemoteOpenCodeSessions` degrades an ssh failure
  // to null today, but guard the await so a future change (or a down SSH path)
  // can't reject resolve() and break transcript discovery for a remote worker.
  let rows: Awaited<ReturnType<typeof listRemoteOpenCodeSessions>>;
  try {
    rows = await listRemoteOpenCodeSessions(session.remote, session.cwd, REMOTE_LIST_LIMIT);
  } catch {
    return undefined;
  }
  if (!rows) return undefined;
  const floor = (session.createdAt ?? 0) - 5_000;
  let best: { id: string; created: number } | undefined;
  for (const row of rows) {
    if (typeof row.created !== 'number' || row.created < floor || !row.id) continue;
    if (row.directory !== session.cwd) continue;
    if (!best || row.created < best.created) best = { id: row.id, created: row.created };
  }
  return best?.id;
}

export class OpenCodeTranscriptAdapter implements HarnessTranscriptAdapter {
  readonly supportsExactResume = true;
  readonly supportsTranscript = true;
  private readonly resolver: OpenCodeSessionResolver;

  constructor(private readonly binary: () => string) {
    this.resolver = new OpenCodeSessionResolver({ binary });
  }

  async resolve(session: TranscriptSessionRef) {
    const nativeId = session.openCodeSessionId
      ?? (session.remote
        ? await resolveRemoteNativeId(session)
        : (await this.resolver.resolve(session.id, session.cwd, session.createdAt ?? 0))?.sessionId);
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
    // A remote worker's opencode.db lives on the remote host — read its stats
    // over ssh via `opencode export`, never the owner's local db (which has no
    // row for this session and would report a zero-token `gap: 'missing'`).
    if (session.remote) {
      // Match the local missing-session path: a transient SSH/remote-exec error
      // degrades to null (a hard stats failure), never a thrown rejection.
      try {
        return await readSessionStatsOpenCodeRemote(session.remote, nativeId, { cwd: session.cwd });
      } catch {
        return null;
      }
    }
    const dbPath = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode', 'opencode.db');
    return (await readSessionStatsOpenCode(nativeId, { dbPath, cwd: session.cwd }))
      ?? readSessionStatsOpenCodeExport(nativeId, { binary: this.binary(), cwd: session.cwd });
  }

  forget(sessionId: string): void {
    this.resolver.forget(sessionId);
  }
}
