/**
 * Provider-agnostic transcript SEAM. The three transcript consumers — idle
 * triage (`readLastTurn`), catch-up (`readDigest`), and session stats
 * (`readSessionStats`) — historically hard-coded the Claude reader + Claude path
 * derivation. This module dispatches those three reads to the right per-provider
 * reader based on the session's launch profile, so a Codex or OpenCode session
 * summarizes and shows stats the same way a Claude session does.
 *
 * The Claude path stays byte-identical: `transcriptPath(cwd, claudeSessionId)` +
 * the Claude reader, exactly as before. The Codex path resolves its rollout file
 * lazily via {@link CodexSessionResolver} using the session's cwd + spawn time
 * (its session id is DETECTED, not minted), then feeds the Codex reader. The
 * OpenCode path is simpler: its id is ALSO detected (not minted), but that
 * detection already happens elsewhere (`OpenCodeSessionResolver`, wired in
 * `index.ts`) and is stamped onto the live session as `openCodeSessionId` before
 * this seam ever sees it — so this seam just reads `ref.openCodeSessionId` and
 * feeds OpenCode's SQLite-backed reader, no resolver of its own.
 *
 * Selection is by CAPABILITY, not a profile-literal (Rule 6): a profile with
 * `hasTranscript` participates; the concrete Codex/OpenCode-vs-Claude branch is
 * chosen by `isCodexProfile`/`isOpenCodeProfile`, provider-family predicates
 * (allowed in the shared launch-provider module, not core logic). Any profile
 * without a transcript yields empty/null — the same "nothing to summarize"
 * degradation the callers already handle.
 *
 * Everything is defensive: a missing file/db, an unresolved id, or a read error
 * yields '' / null, never a throw — the never-throw contract the three
 * micro-call services depend on.
 */

import { isCodexProfile, isOpenCodeProfile, providerCapabilities } from '../shared/launch-provider.js';
import type { LaunchProfileId } from '../shared/types.js';
import { transcriptPath, readLastAssistantText, readSessionDigest, readSessionStats } from './transcript-reader.js';
import {
  readLastAssistantTextCodex,
  readSessionDigestCodex,
  readSessionStatsCodex
} from './codex-transcript-reader.js';
import {
  readLastAssistantTextOpenCode,
  readSessionDigestOpenCode,
  readSessionStatsOpenCode
} from './opencode-transcript-reader.js';
import { CodexSessionResolver } from './codex-session-resolver.js';
import type { SessionStats } from '@shared/types';

/** The session fields the seam needs to locate + read a transcript. */
export interface TranscriptSessionRef {
  /** PTY session id — the resolver cache key for Codex. */
  id: string;
  profile: string;
  cwd: string;
  /** Claude's minted session id (Claude only; undefined for Codex/OpenCode). */
  claudeSessionId?: string;
  /**
   * OpenCode's minted session id (OpenCode only), already DETECTED and stamped
   * onto the live `TerminalSession` by `OpenCodeSessionResolver` — unlike Codex,
   * this seam does no resolution of its own for OpenCode, it just reads the id.
   */
  openCodeSessionId?: string;
  /** Spawn time (epoch ms) — the floor for Codex rollout detection. */
  createdAt?: number;
}

/**
 * Dispatches transcript reads to the correct per-provider reader. One instance
 * per app (owns the Codex resolver cache); wire it where the three services are
 * constructed. `forget(id)` frees a Codex session's cached rollout match on
 * close (Rule 5).
 */
export class TranscriptSource {
  private readonly codexResolver: CodexSessionResolver;
  private readonly onCodexResolved?: (id: string, sessionId: string) => void;
  /** Ids we've already reported a Codex match for — fire `onCodexResolved` once. */
  private readonly reported = new Set<string>();

  /**
   * @param onCodexResolved Fired ONCE per PTY session the first time its Codex
   *   rollout UUID is detected — lets the caller stamp `codexSessionId` onto the
   *   session record so restore can `codex resume <id>`. Optional (tests/
   *   read-only callers omit it).
   */
  constructor(
    codexResolver: CodexSessionResolver = new CodexSessionResolver(),
    onCodexResolved?: (id: string, sessionId: string) => void
  ) {
    this.codexResolver = codexResolver;
    this.onCodexResolved = onCodexResolved;
  }

  /** Release per-session state on close. */
  forget(id: string): void {
    this.codexResolver.forget(id);
    this.reported.delete(id);
  }

  /** True when this profile has a readable transcript at all. */
  private hasTranscript(profile: string): boolean {
    return providerCapabilities(profile as LaunchProfileId).hasTranscript;
  }

  /** Resolve the Codex rollout path for a session, or null if not yet detectable. */
  private async codexPath(ref: TranscriptSessionRef): Promise<string | null> {
    const match = await this.codexResolver.resolve(ref.id, ref.cwd, ref.createdAt ?? 0);
    if (match && this.onCodexResolved && !this.reported.has(ref.id)) {
      this.reported.add(ref.id);
      // Stamp the detected UUID onto the session record (fire-and-forget; the
      // callback swallows a missing session). Never lets a stamp failure break
      // the read.
      try {
        this.onCodexResolved(ref.id, match.sessionId);
      } catch {
        /* stamping is best-effort — a read must never throw on it */
      }
    }
    return match?.rolloutPath ?? null;
  }

  /** Last assistant prose for idle triage. '' when unavailable. Never throws. */
  async readLastTurn(ref: TranscriptSessionRef): Promise<string> {
    if (!this.hasTranscript(ref.profile)) return '';
    if (isCodexProfile(ref.profile as LaunchProfileId)) {
      const path = await this.codexPath(ref);
      return path ? readLastAssistantTextCodex(path) : '';
    }
    if (isOpenCodeProfile(ref.profile as LaunchProfileId)) {
      return ref.openCodeSessionId ? readLastAssistantTextOpenCode(ref.openCodeSessionId) : '';
    }
    const path = transcriptPath(ref.cwd, ref.claudeSessionId);
    return path ? readLastAssistantText(path) : '';
  }

  /** Whole-session digest for catch-up/close summaries. '' when unavailable. */
  async readDigest(ref: TranscriptSessionRef): Promise<string> {
    if (!this.hasTranscript(ref.profile)) return '';
    if (isCodexProfile(ref.profile as LaunchProfileId)) {
      const path = await this.codexPath(ref);
      return path ? readSessionDigestCodex(path) : '';
    }
    if (isOpenCodeProfile(ref.profile as LaunchProfileId)) {
      return ref.openCodeSessionId ? readSessionDigestOpenCode(ref.openCodeSessionId) : '';
    }
    const path = transcriptPath(ref.cwd, ref.claudeSessionId);
    return path ? readSessionDigest(path) : '';
  }

  /** Display-only session stats (model/tokens/cost/files). null when unavailable. */
  async readStats(ref: TranscriptSessionRef): Promise<SessionStats | null> {
    if (!this.hasTranscript(ref.profile)) return null;
    if (isCodexProfile(ref.profile as LaunchProfileId)) {
      const path = await this.codexPath(ref);
      return path ? readSessionStatsCodex(path) : null;
    }
    if (isOpenCodeProfile(ref.profile as LaunchProfileId)) {
      return ref.openCodeSessionId ? readSessionStatsOpenCode(ref.openCodeSessionId) : null;
    }
    const path = transcriptPath(ref.cwd, ref.claudeSessionId);
    return path ? readSessionStats(path) : null;
  }
}
