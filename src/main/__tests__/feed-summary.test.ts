import { describe, it, expect } from 'vitest';
import {
  FeedSummaryService,
  parseFeedDigest,
  renderEventsForPrompt,
  type FeedSummaryDeps
} from '../feed-summary.js';
import type { FeedEvent, LlmRunResult } from '../../shared/types.js';

const NOW = 1_700_000_000_000;

function ev(over: Partial<FeedEvent> = {}): FeedEvent {
  return {
    id: 'e1',
    projectId: 'p1',
    kind: 'commit',
    ts: NOW - 120_000,
    title: 'feat: add feed',
    ...over
  };
}

describe('renderEventsForPrompt', () => {
  it('renders one line per event with a human kind label + relative age', () => {
    const out = renderEventsForPrompt(
      [ev({ kind: 'goal-achieved', title: 'Goal achieved: X', ts: NOW - 3_600_000 })],
      NOW
    );
    expect(out).toBe('- [goal · 1h ago] Goal achieved: X');
  });

  it('skips events with an empty title', () => {
    expect(renderEventsForPrompt([ev({ title: '' })], NOW)).toBe('');
  });
});

describe('parseFeedDigest', () => {
  it('parses a clean JSON object', () => {
    const d = parseFeedDigest('{"headline":"Shipped feed","highlights":["12 commits","2 goals"]}');
    expect(d).toEqual({ headline: 'Shipped feed', highlights: ['12 commits', '2 goals'] });
  });

  it('tolerates surrounding prose / code fences', () => {
    const d = parseFeedDigest('Sure!\n```json\n{"headline":"H","highlights":[]}\n```');
    expect(d?.headline).toBe('H');
  });

  it('clamps highlights to 5 and drops non-strings', () => {
    const d = parseFeedDigest(
      JSON.stringify({ headline: 'H', highlights: ['a', 'b', 'c', 'd', 'e', 'f', 3] })
    );
    expect(d?.highlights).toHaveLength(5);
  });

  it('returns null on empty headline or unparsable input', () => {
    expect(parseFeedDigest('{"headline":"","highlights":[]}')).toBeNull();
    expect(parseFeedDigest('not json')).toBeNull();
  });
});

describe('FeedSummaryService.summarize', () => {
  function svc(over: Partial<FeedSummaryDeps> = {}) {
    const deps: FeedSummaryDeps = {
      readEvents: async () => [ev()],
      runSummary: async (): Promise<LlmRunResult> => ({
        ok: true,
        text: '{"headline":"Recap","highlights":["a"]}',
        provider: 'claude-cli',
        ms: 1
      }),
      ...over
    };
    return new FeedSummaryService(deps, () => NOW);
  }

  it('returns ok with a digest on success', async () => {
    const res = await svc().summarize('p1');
    expect(res).toEqual({ ok: true, digest: { headline: 'Recap', highlights: ['a'] }, eventCount: 1 });
  });

  it('reports empty when there are no events', async () => {
    const res = await svc({ readEvents: async () => [] }).summarize('p1');
    expect(res).toEqual({ ok: false, reason: 'empty' });
  });

  it('reports summary-failed when the model output is unusable', async () => {
    const res = await svc({
      runSummary: async () => ({ ok: true, text: 'garbage', provider: 'claude-cli', ms: 1 })
    }).summarize('p1');
    expect(res).toEqual({ ok: false, reason: 'summary-failed' });
  });

  it('reports summary-failed when the micro-call itself fails', async () => {
    const res = await svc({
      runSummary: async () => ({ ok: false, text: '', provider: 'claude-cli', ms: 0 })
    }).summarize('p1');
    expect(res).toEqual({ ok: false, reason: 'summary-failed' });
  });
});
