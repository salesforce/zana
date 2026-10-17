import type { DesignDocSummary } from '../shared/contract.js';

/** Docs remembered as opened; the oldest are forgotten past it. */
export const MAX_SEEN_DOCS = 500;

/**
 * When the user last saw each doc. A doc never opened counts as seen at
 * `since`, when tracking started, so existing docs do not all light up.
 */
export interface SeenState {
  since: number;
  docs: Record<string, number>;
}

export function parseSeen(raw: string, now: number): SeenState {
  try {
    const value = JSON.parse(raw) as Partial<SeenState> | null;
    if (value && typeof value.since === 'number' && value.docs && typeof value.docs === 'object') {
      const docs: Record<string, number> = {};
      for (const [id, at] of Object.entries(value.docs)) if (typeof at === 'number') docs[id] = at;
      return { since: value.since, docs };
    }
  } catch {
    // Unreadable: start over.
  }
  return { since: now, docs: {} };
}

/** Record that the user saw the doc as of `at`; null when nothing changes. */
export function markSeen(state: SeenState, docId: string, at: number): SeenState | null {
  if ((state.docs[docId] ?? state.since) >= at) return null;
  const entries = Object.entries({ ...state.docs, [docId]: at })
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SEEN_DOCS);
  return { since: state.since, docs: Object.fromEntries(entries) };
}

/** An agent changed the doc after the user last saw it. */
export function unseenAgentEdit(doc: DesignDocSummary, state: SeenState): boolean {
  return doc.updatedBy.kind === 'agent' && doc.updatedAt > (state.docs[doc.id] ?? state.since);
}
