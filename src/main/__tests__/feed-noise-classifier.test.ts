import { describe, it, expect, vi } from 'vitest';
import type { InboxEntry, LlmRunResult } from '../../shared/types.js';
import {
  FeedNoiseClassifier,
  isDemotionCandidate,
  renderCandidatesForPrompt,
  parseRoutineIds
} from '../feed-noise-classifier.js';
import {
  AUTO_CLOSE_KEY_PREFIX,
  HEARTBEAT_KEY_PREFIX,
  GOAL_KEY_PREFIX
} from '../../renderer/util/feedCategories.js';

function e(over: Partial<InboxEntry> & { id: string }): InboxEntry {
  return { ts: 0, projectId: 'p', comments: 'did a thing', ...over };
}

function okResult(text: string): LlmRunResult {
  return { ok: true, text, provider: 'claude-cli', ms: 5 };
}

describe('isDemotionCandidate (deterministic gate)', () => {
  it('accepts a plain comment-only report', () => {
    expect(isDemotionCandidate(e({ id: 'r' }))).toBe(true);
  });

  it('rejects pinned SIGNAL and folded-by-rule entries', () => {
    expect(isDemotionCandidate(e({ id: 'q', question: { options: [] } }))).toBe(false);
    expect(isDemotionCandidate(e({ id: 'd', docs: [{ path: 'a.md' }] }))).toBe(false);
    expect(isDemotionCandidate(e({ id: 'g', dedupeKey: `${GOAL_KEY_PREFIX}p:g1` }))).toBe(false);
    expect(isDemotionCandidate(e({ id: 'ac', dedupeKey: `${AUTO_CLOSE_KEY_PREFIX}s1` }))).toBe(false);
    expect(isDemotionCandidate(e({ id: 'hb', dedupeKey: `${HEARTBEAT_KEY_PREFIX}s1` }))).toBe(false);
    expect(isDemotionCandidate(e({ id: 's', scheduled: true }))).toBe(false);
  });

  it('rejects an entry with no gist (nothing to judge)', () => {
    expect(isDemotionCandidate(e({ id: 'blank', comments: '   ' }))).toBe(false);
  });
});

describe('renderCandidatesForPrompt', () => {
  it('emits one `- [id] gist` line per candidate, skipping gistless entries', () => {
    const text = renderCandidatesForPrompt([
      e({ id: 'r1', comments: 'ran the tests' }),
      e({ id: 'r2', comments: '' })
    ]);
    expect(text).toBe('- [r1] ran the tests');
  });
});

describe('parseRoutineIds', () => {
  const valid = new Set(['r1', 'r2']);

  it('parses a clean reply intersected with valid ids', () => {
    expect(parseRoutineIds('{"routine":["r1","r2"]}', valid)).toEqual(['r1', 'r2']);
  });

  it('drops hallucinated / stale ids not in the candidate set', () => {
    expect(parseRoutineIds('{"routine":["r1","ghost"]}', valid)).toEqual(['r1']);
  });

  it('tolerates prose / fences around the JSON and dedupes', () => {
    expect(parseRoutineIds('sure!\n```\n{"routine":["r1","r1"]}\n```', valid)).toEqual(['r1']);
  });

  it('returns [] on unparsable / empty / non-array', () => {
    expect(parseRoutineIds('', valid)).toEqual([]);
    expect(parseRoutineIds('not json', valid)).toEqual([]);
    expect(parseRoutineIds('{"routine":"nope"}', valid)).toEqual([]);
  });
});

describe('FeedNoiseClassifier.classify', () => {
  it('returns only gated, validated routine ids', async () => {
    const entries: InboxEntry[] = [
      e({ id: 'r1', comments: 'routine ping' }),
      e({ id: 'r2', comments: 'BUILD FAILED' }),
      e({ id: 'q', question: { options: [] } }), // filtered by the gate
      e({ id: 'g', dedupeKey: `${GOAL_KEY_PREFIX}p:g1` }) // filtered by the gate
    ];
    const runClassify = vi.fn().mockResolvedValue(okResult('{"routine":["r1","q","g"]}'));
    const svc = new FeedNoiseClassifier({
      readEntries: async () => entries,
      runClassify
    });
    const res = await svc.classify(null);
    // q + g were never candidates, so even though the model named them they can't be demoted.
    expect(res.routineIds).toEqual(['r1']);
    expect(res.candidateCount).toBe(2);
    // The prompt only ever saw the two real candidates.
    const prompt = runClassify.mock.calls[0][0] as string;
    expect(prompt).toContain('[r1]');
    expect(prompt).toContain('[r2]');
    expect(prompt).not.toContain('[q]');
    expect(prompt).not.toContain('[g]');
  });

  it('short-circuits (no LLM call) when there are no candidates', async () => {
    const runClassify = vi.fn();
    const svc = new FeedNoiseClassifier({
      readEntries: async () => [e({ id: 'q', question: { options: [] } })],
      runClassify
    });
    const res = await svc.classify('proj');
    expect(res).toEqual({ routineIds: [], candidateCount: 0 });
    expect(runClassify).not.toHaveBeenCalled();
  });

  it('degrades to empty demotion on a failed LLM call (never throws)', async () => {
    const svc = new FeedNoiseClassifier({
      readEntries: async () => [e({ id: 'r1' })],
      runClassify: async () => ({ ok: false, text: '', error: 'timeout', provider: 'claude-cli', ms: 1 })
    });
    const res = await svc.classify(null);
    expect(res.routineIds).toEqual([]);
    expect(res.candidateCount).toBe(1);
  });

  it('scopes the dedupeKey by project', async () => {
    const runClassify = vi.fn().mockResolvedValue(okResult('{"routine":[]}'));
    const svc = new FeedNoiseClassifier({ readEntries: async () => [e({ id: 'r1' })], runClassify });
    await svc.classify('projX');
    expect(runClassify.mock.calls[0][1]).toBe('feed-noise:projX');
  });
});
