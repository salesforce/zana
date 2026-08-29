import { describe, it, expect, vi } from 'vitest';
import {
  parseReviewerVerdict,
  ReviewerApprovalService,
  REVIEWER_MIN_CONFIDENCE,
  type ReviewerRequest
} from './reviewer-approval.js';
import type { LlmRunResult } from '@zana-ai/zcc-domain/product';

const req: ReviewerRequest = { moduleId: 'gus', permission: 'exec', summary: 'exec: git' };
const ok = (text: string): LlmRunResult => ({ ok: true, text, provider: 'claude-cli', ms: 1 });

describe('parseReviewerVerdict — fails closed', () => {
  it('approves only a well-formed high-confidence approve', () => {
    expect(parseReviewerVerdict('{"decision":"approve","confidence":0.9}')).toBe('approve');
  });
  it('asks on low confidence', () => {
    expect(parseReviewerVerdict('{"decision":"approve","confidence":0.5}')).toBe('ask');
  });
  it('asks on empty / off-shape / unparseable / non-approve / non-numeric', () => {
    for (const t of ['', 'no json here', '{bad', '{"decision":"ask","confidence":1}',
                     '{"decision":"approve","confidence":"high"}', '{"confidence":0.9}']) {
      expect(parseReviewerVerdict(t)).toBe('ask');
    }
  });
  it('tolerates surrounding prose/fences', () => {
    expect(parseReviewerVerdict('sure: ```{"decision":"approve","confidence":0.95}``` done'))
      .toBe('approve');
  });
});

describe('ReviewerApprovalService', () => {
  it('peek miss returns ask AND schedules a consult that warms the cache', async () => {
    const runReview = vi.fn(async () => ok('{"decision":"approve","confidence":0.9}'));
    const svc = new ReviewerApprovalService({ runReview });
    expect(svc.peek('k', req)).toBe('ask');          // miss → ask
    await svc.consult('k', req);                      // warm
    expect(svc.peek('k', req)).toBe('approve');       // hit → approve
    expect(runReview).toHaveBeenCalledTimes(1);
  });
  it('never throws when runReview rejects → ask', async () => {
    const svc = new ReviewerApprovalService({ runReview: vi.fn(async () => { throw new Error('boom'); }) });
    await expect(svc.consult('k', req)).resolves.toBe('ask');
    expect(svc.peek('k', req)).toBe('ask');
  });
  it('ok:false result → ask', async () => {
    const svc = new ReviewerApprovalService({
      runReview: vi.fn(async (): Promise<LlmRunResult> => ({ ok: false, text: '', error: 'x', provider: 'claude-cli', ms: 0 }))
    });
    await expect(svc.consult('k', req)).resolves.toBe('ask');
  });
  it('evicts on TTL', async () => {
    let t = 1000;
    const svc = new ReviewerApprovalService(
      { runReview: vi.fn(async () => ok('{"decision":"approve","confidence":0.9}')) },
      () => t, 100, 200
    );
    await svc.consult('k', req);
    expect(svc.peek('k', req)).toBe('approve');
    t += 200;                                          // past TTL
    expect(svc.peek('k', req)).toBe('ask');
  });
  it('caps cache size (LRU-ish eviction, no unbounded growth)', async () => {
    const svc = new ReviewerApprovalService(
      { runReview: vi.fn(async () => ok('{"decision":"approve","confidence":0.9}')) },
      () => 1, 100_000, 2
    );
    await svc.consult('a', req); await svc.consult('b', req); await svc.consult('c', req);
    // Only 2 kept; 'a' (oldest) evicted.
    expect(svc.peek('a', req)).toBe('ask');
  });
  it('exposes REVIEWER_MIN_CONFIDENCE = 0.8', () => {
    expect(REVIEWER_MIN_CONFIDENCE).toBe(0.8);
  });
});
