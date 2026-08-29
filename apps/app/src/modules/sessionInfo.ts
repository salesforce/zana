/**
 * Pure mapper: core's rich `TerminalSession` → the SDK's minimal
 * `SessionInfo` projection emitted on the `'session:updated'` host event.
 * Kept dependency-light (structural input, no store/preload imports) so it can
 * be unit-tested in isolation.
 */

import type { SessionInfo } from '@zana-ai/zcc-extension-sdk/renderer';

/** The subset of `TerminalSession` fields this projection reads. */
export interface SessionLike {
  id: string;
  projectId: string;
  title: string;
  status: string;
}

/** Project a core session onto the SDK's stable `SessionInfo` shape. */
export function toSessionInfo(session: SessionLike): SessionInfo {
  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    status: session.status
  };
}
