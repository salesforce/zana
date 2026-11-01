import { describe, it, expect, vi } from 'vitest';
import {
  FeedSummaryService,
  parseFeedDigest,
  renderEventsForPrompt,
  type FeedSummaryDeps
} from './feed-summary.js';
import type { FeedEvent, LlmRunResult } from '@zana-ai/zcc-domain/product';
import { WorkloadMemo, WORKLOAD_MEMO_SKIPPED } from '@zana-ai/zcc-llm';

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

  it('reuses a validated digest only for the same trusted request identity', async () => {
    const runSummary = vi.fn(async () => ({ ok: true, text: '{"headline":"Recap","highlights":[]}', provider: 'claude-cli' as const, ms: 1 }));
    const service = new FeedSummaryService({
      readEvents: async () => [ev()], runSummary,
      requestIdentity: (text) => text,
      memo: new WorkloadMemo()
    }, () => NOW);
    await service.summarize('p1');
    await service.summarize('p1');
    expect(runSummary).toHaveBeenCalledTimes(1);
  });

  it('reruns when trusted identity changes', async () => {
    let identity = 'first';
    const runSummary = vi.fn(async () => ({ ok: true, text: '{"headline":"Recap","highlights":[]}', provider: 'claude-cli' as const, ms: 1 }));
    const service = new FeedSummaryService({ readEvents: async () => [ev()], runSummary, requestIdentity: () => identity, memo: new WorkloadMemo() }, () => NOW);
    await service.summarize('p1');
    identity = 'second';
    await service.summarize('p1');
    expect(runSummary).toHaveBeenCalledTimes(2);
  });

  it('falls back to the direct provider when the memo skips the workload', async () => {
    const runSummary = vi.fn(async () => ({ ok: true, text: '{"headline":"Direct","highlights":[]}', provider: 'claude-cli' as const, ms: 1 }));
    const memo = {
      getOrCompute: vi.fn(async (_workload, _key, _ttl, compute) => {
        await compute();
        return WORKLOAD_MEMO_SKIPPED;
      })
    };

    const result = await svc({ runSummary, memo }).summarize('p1');

    expect(result).toEqual({ ok: true, digest: { headline: 'Direct', highlights: [] }, eventCount: 1 });
    expect(runSummary).toHaveBeenCalledTimes(2);
    expect(memo.getOrCompute).toHaveBeenCalledWith('feed-digest', expect.stringContaining('feed-digest:p1:'), 300_000, expect.any(Function));
  });

  it('returns a memo hit with the current event count without invoking the provider', async () => {
    const runSummary = vi.fn();
    const result = await svc({
      readEvents: async () => [ev(), ev({ id: 'e2' })],
      runSummary,
      memo: { getOrCompute: async () => ({ headline: 'Cached', highlights: ['a'] }) }
    }).summarize('p1');

    expect(result).toEqual({ ok: true, digest: { headline: 'Cached', highlights: ['a'] }, eventCount: 2 });
    expect(runSummary).not.toHaveBeenCalled();
  });

  it('reports summary-failed when the memo cannot produce a digest', async () => {
    const runSummary = vi.fn();
    const result = await svc({
      runSummary,
      memo: { getOrCompute: async () => undefined }
    }).summarize('p1');

    expect(result).toEqual({ ok: false, reason: 'summary-failed' });
    expect(runSummary).not.toHaveBeenCalled();
  });
});
