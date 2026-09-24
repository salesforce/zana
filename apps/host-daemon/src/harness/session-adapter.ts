import type { HarnessSessionAdapter, HarnessSessionReference } from '@zcc/harness-sdk';
import type { SessionStats } from '@zana-ai/zcc-domain/product';
import type { LaunchProfileId } from '@zana-ai/zcc-domain/product';

/**
 * SSH target of a REMOTE session, so a transcript adapter can run its native
 * discovery/read commands ON THE HOST where the harness store actually lives
 * (e.g. OpenCode's `opencode.db`) instead of the owner's local filesystem.
 * Populated only for `scope: 'remote'` sessions; absent for local ones. Fields
 * mirror the subset of {@link ProjectRemote} the ssh invocation needs; each is
 * validated (no leading `-`) before it reaches an ssh argv.
 */
export interface RemoteTranscriptTarget {
  readonly host: string;
  readonly user?: string;
  readonly proxyJump?: string;
}

/** Main-owned metadata needed to locate a harness transcript. */
export interface TranscriptSessionRef {
  readonly id: string;
  readonly profile: string;
  readonly cwd: string;
  readonly claudeSessionId?: string;
  readonly codexSessionId?: string;
  readonly openCodeSessionId?: string;
  readonly createdAt?: number;
  /**
   * Present only for a remote (SSH) session — the host its harness store lives
   * on. When set, an adapter runs its native CLI over ssh against this target
   * rather than the local machine.
   */
  readonly remote?: RemoteTranscriptTarget;
}

/**
 * The app binding of the SDK session contract. The patch is applied by the
 * trusted PTY manager after a resolver detects a harness-owned native id.
 */
export interface HarnessTranscriptAdapter extends HarnessSessionAdapter<TranscriptSessionRef, SessionStats> {
  readonly supportsTranscript: true;
}

/** Only these main-owned fields can be populated by a harness resolver. */
export type NativeSessionPatch =
  | { readonly kind: 'codex'; readonly codexSessionId: string }
  | { readonly kind: 'opencode'; readonly openCodeSessionId: string }
  | { readonly kind: 'native'; readonly nativeConversationId: string };

/** Convert an allowed native patch to persisted TerminalSession fields only. */
export function nativeSessionFields(patch: NativeSessionPatch | undefined): {
  codexSessionId?: string;
  openCodeSessionId?: string;
  nativeConversationId?: string;
} {
  if (!patch) return {};
  if (patch.kind === 'codex') return { codexSessionId: patch.codexSessionId };
  if (patch.kind === 'opencode') return { openCodeSessionId: patch.openCodeSessionId };
  return { nativeConversationId: patch.nativeConversationId };
}
