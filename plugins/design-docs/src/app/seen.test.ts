import { describe, expect, it } from 'vitest';
import type { DesignDocSummary, DocActor } from '../shared/contract.js';
import { MAX_SEEN_DOCS, markSeen, parseSeen, unseenAgentEdit } from './seen.js';

const user: DocActor = { kind: 'user', label: 'You', threadId: null };
const agent: DocActor = { kind: 'agent', label: 'Planner', threadId: 't1' };

function doc(id: string, updatedAt: number, updatedBy: DocActor = agent): DesignDocSummary {
  return {
    id,
    slug: id,
    title: id,
    summary: '',
    status: 'draft',
    projectId: null,
    tags: [],
    entryPath: 'README.md',
    fileCount: 1,
    openComments: 0,
    lastComment: null,
    pinnedAt: null,
    alternativeTo: null,
    revision: 1,
    createdAt: 0,
    updatedAt,
    createdBy: user,
    updatedBy
  };
}

describe('seen docs', () => {
  it('starts tracking now when nothing usable is stored', () => {
    expect(parseSeen('', 50)).toEqual({ since: 50, docs: {} });
    expect(parseSeen('{bad', 50)).toEqual({ since: 50, docs: {} });
    expect(parseSeen('null', 50)).toEqual({ since: 50, docs: {} });
    expect(parseSeen('{"since":"x","docs":{}}', 50)).toEqual({ since: 50, docs: {} });
    expect(parseSeen('{"since":10,"docs":{"a":20,"b":"x"}}', 50)).toEqual({ since: 10, docs: { a: 20 } });
  });

  it('flags agent edits made after the doc was last seen', () => {
    const state = { since: 100, docs: { a: 200 } };
    expect(unseenAgentEdit(doc('a', 200), state)).toBe(false);
    expect(unseenAgentEdit(doc('a', 201), state)).toBe(true);
    expect(unseenAgentEdit(doc('a', 300, user), state)).toBe(false);
    // Never opened: compared with when tracking started.
    expect(unseenAgentEdit(doc('b', 100), state)).toBe(false);
    expect(unseenAgentEdit(doc('b', 101), state)).toBe(true);
  });

  it('marks docs seen, skips no-ops, and forgets the oldest past the cap', () => {
    const state = { since: 100, docs: { a: 200 } };
    expect(markSeen(state, 'a', 150)).toBeNull();
    expect(markSeen(state, 'b', 90)).toBeNull();
    expect(markSeen(state, 'b', 300)).toEqual({ since: 100, docs: { a: 200, b: 300 } });

    const full = { since: 0, docs: Object.fromEntries(Array.from({ length: MAX_SEEN_DOCS }, (_, index) => [`d${index}`, index + 1])) };
    const next = markSeen(full, 'new', 10_000)!;
    expect(Object.keys(next.docs)).toHaveLength(MAX_SEEN_DOCS);
    expect(next.docs.new).toBe(10_000);
    expect(next.docs.d0).toBeUndefined();
  });
});
