/** A line shown under a pane's actions: what happened and, when the host could not ask, what to say to an agent instead. */
export type Message = { tone: 'ok' | 'muted' | 'error'; text: string; ask?: string };

/** What to say when the host did not sign an approval. Shared by the Tests panes. */
export function declined(reason: 'cancelled' | 'unavailable' | 'busy' | 'invalid', ask?: string): Message {
  switch (reason) {
    case 'unavailable': return { tone: 'error', text: 'Approvals need the Zana desktop app. Ask the agent in a thread to do this instead.', ...(ask ? { ask } : {}) };
    case 'busy': return { tone: 'error', text: 'Another approval is open in this window. Finish it first.' };
    case 'invalid': return { tone: 'error', text: 'Zana could not show this approval.' };
    default: return { tone: 'muted', text: 'Cancelled. Nothing changed.' };
  }
}
