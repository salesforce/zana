import { useApplicationTabs } from './application-tabs.js';

/**
 * Session ids whose process is being replaced (restart / reconnect mints a new id).
 * The prune pass must not close their tabs while the swap is in flight.
 */
export const resumingAgents = new Set<string>();

/**
 * Run a restart that mints a new session id. The old tab is marked in flight,
 * then swapped in place for the new id so its position survives; on failure the
 * mark is cleared and the tab stays.
 */
export async function withAgentTabReplace<T extends { id: string } | null>(
  oldId: string,
  projectId: string,
  mint: () => Promise<T>
): Promise<T> {
  resumingAgents.add(oldId);
  try {
    const next = await mint();
    if (next && next.id !== oldId) {
      const tabs = useApplicationTabs.getState();
      const old = tabs.open.find((tab) => tab.kind === 'agent' && tab.sessionId === oldId);
      if (old && old.kind === 'agent')
        tabs.replaceTab(`agent:${oldId}`, {
          kind: 'agent',
          sessionId: next.id,
          projectId,
          projectScoped: old.projectScoped
        });
    }
    return next;
  } finally {
    resumingAgents.delete(oldId);
  }
}
