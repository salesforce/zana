import type { HarnessSessionAdapter, HarnessSessionReference } from '@zcc/harness-sdk';
import type { SessionStats } from '@shared/types';
import type { LaunchProfileId } from '../../shared/types.js';

/** Main-owned metadata needed to locate a harness transcript. */
export interface TranscriptSessionRef {
  readonly id: string;
  readonly profile: string;
  readonly cwd: string;
  readonly claudeSessionId?: string;
  readonly codexSessionId?: string;
  readonly openCodeSessionId?: string;
  readonly createdAt?: number;
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
  | { readonly kind: 'opencode'; readonly openCodeSessionId: string };

/** Convert an allowed native patch to persisted TerminalSession fields only. */
export function nativeSessionFields(patch: NativeSessionPatch | undefined): {
  codexSessionId?: string;
  openCodeSessionId?: string;
} {
  if (!patch) return {};
  return patch.kind === 'codex'
    ? { codexSessionId: patch.codexSessionId }
    : { openCodeSessionId: patch.openCodeSessionId };
}
