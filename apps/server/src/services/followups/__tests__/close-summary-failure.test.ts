import { describe, expect, it, vi } from 'vitest';
import { CloseSummaryService, warnCloseSummary, type CloseSummaryDeps } from '../close-summary.js';
import type { LlmRunResult } from '@zana-ai/zcc-domain/product';

const ok = (text: string): LlmRunResult => ({ ok: true, text, provider: 'claude-cli', ms: 1 });
const bad = (error: string): LlmRunResult => ({ ok: false, text: '', error, provider: 'claude-cli', ms: 1 });

function make(over: Partial<CloseSummaryDeps> = {}) {
  const log = vi.fn();
  const deps: CloseSummaryDeps = {
    getSession: () => ({ projectId: 'p', profile: 'claude', cwd: '/x', title: 'Agent' }),
    hasTranscript: () => true,
    readLastTurn: async () => 'last turn',
    runSummary: async () => ok('{"did":"a","left":"b"}'),
    runTurnSummary: async () => ok('t'),
    readDigest: async () => '',
    runSessionSummary: async () => ok('s'),
    appendInbox: async () => ({ id: 'e1' }),
    projectLabel: () => 'Proj',
    createFollowUp: async () => 'f1',
    log,
    ...over
  };
  return { svc: new CloseSummaryService(deps), log };
}

describe('warnCloseSummary', () => {
  it('writes the context and detail as a [zcc] warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    warnCloseSummary('close-summary', 'summary-failed: boom');
    expect(warn).toHaveBeenCalledWith('[zcc] close-summary: summary-failed: boom');
    warn.mockRestore();
  });
});

describe('close summary failures', () => {
  it('reports empty when there is no transcript text', async () => {
    const { svc, log } = make({ readLastTurn: async () => '' });
    const res = await svc.summarizeAndFollowUp('p', ['s1']);
    expect(res).toEqual({ summarized: 0, followedUp: 0, failures: [{ reason: 'empty' }] });
    // An agent with no transcript yet is normal: reported to the caller, not logged as an error.
    expect(log).not.toHaveBeenCalled();
  });

  it('reports summary-failed with the LLM error trimmed to 200 chars', async () => {
    const { svc, log } = make({ runSummary: async () => bad(`  ${'e'.repeat(300)}  `) });
    const res = await svc.summarizeAndFollowUp('p', ['s1']);
    expect(res.failures).toEqual([{ reason: 'summary-failed', detail: 'e'.repeat(200) }]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('reports unparseable replies', async () => {
    const { svc, log } = make({ runSummary: async () => ok('not json') });
    const res = await svc.summarizeAndFollowUp('p', ['s1']);
    expect(res.failures).toEqual([{ reason: 'unparseable' }]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('reports a thrown error as summary-failed', async () => {
    const { svc, log } = make({ readLastTurn: async () => { throw new Error('spawn EACCES'); } });
    const res = await svc.summarizeAndFollowUp('p', ['s1']);
    expect(res.failures).toEqual([{ reason: 'summary-failed', detail: 'spawn EACCES' }]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('reports an inbox write failure but still files the follow-up', async () => {
    const { svc, log } = make({ appendInbox: async () => { throw new Error('disk full'); } });
    const res = await svc.summarizeAndFollowUp('p', ['s1']);
    expect(res).toMatchObject({ summarized: 0, followedUp: 1, failures: [{ reason: 'write-failed', detail: 'disk full' }] });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('reports a follow-up that resolves to null (the desktop host logs its own error and returns null)', async () => {
    const { svc, log } = make({ createFollowUp: async () => null });
    const res = await svc.summarizeAndFollowUp('p', ['s1']);
    expect(res).toMatchObject({ summarized: 1, followedUp: 0, failures: [{ reason: 'write-failed' }] });
    // The host already logged its own error before returning null: no second entry here.
    expect(log).not.toHaveBeenCalled();
  });

  it('logs a thrown follow-up error exactly once', async () => {
    const { svc, log } = make({ createFollowUp: async () => { throw new Error('db locked'); } });
    await svc.summarizeAndFollowUp('p', ['s1']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('close-summary', 'write-failed: db locked');
  });

  it('reports empty for a project session without a transcript, and discards unknown or cross-project ones', async () => {
    const sessions: Record<string, { projectId: string; profile: string; cwd: string; title: string } | null> = {
      mine: { projectId: 'p', profile: 'shell', cwd: '/x', title: 'A' },
      other: { projectId: 'q', profile: 'shell', cwd: '/x', title: 'B' },
      gone: null
    };
    const { svc, log } = make({ getSession: (id: string) => sessions[id] ?? null, hasTranscript: () => false });
    const res = await svc.summarizeAndFollowUp('p', ['mine', 'other', 'gone']);
    expect(res).toEqual({ summarized: 0, followedUp: 0, failures: [{ reason: 'empty' }] });
    expect(log).not.toHaveBeenCalled();
  });

  it('reports a follow-up write failure', async () => {
    const { svc } = make({ createFollowUp: async () => { throw new Error('db locked'); } });
    const res = await svc.summarizeAndFollowUp('p', ['s1']);
    expect(res).toMatchObject({ summarized: 1, followedUp: 0, failures: [{ reason: 'write-failed', detail: 'db locked' }] });
  });

  it('has no failures on success and does not log', async () => {
    const { svc, log } = make();
    const res = await svc.summarizeAndFollowUp('p', ['s1']);
    expect(res).toEqual({ summarized: 1, followedUp: 1 });
    expect(log).not.toHaveBeenCalled();
  });

  it('works without a logger', async () => {
    const { svc } = make({ log: undefined, runSummary: async () => bad('x') });
    expect((await svc.summarizeAndFollowUp('p', ['s1'])).failures).toHaveLength(1);
  });

  it('summarize reports failures and write failures', async () => {
    const a = make({ runSummary: async () => bad('boom') });
    expect(await a.svc.summarize('p', ['s1'])).toEqual({ summarized: 0, failures: [{ reason: 'summary-failed', detail: 'boom' }] });
    const b = make({ appendInbox: async () => { throw new Error('nope'); } });
    expect(await b.svc.summarize('p', ['s1'])).toEqual({ summarized: 0, failures: [{ reason: 'write-failed', detail: 'nope' }] });
  });

  it('last-turn path reports empty, failed, unparseable, thrown', async () => {
    const item = { sessionId: 's1', title: 'T', lastTurn: 'hello' };
    expect((await make().svc.summarizeAndFollowUpFromLastTurn('p', { ...item, lastTurn: ' ' })).failures).toEqual([{ reason: 'empty' }]);
    expect((await make({ runSummary: async () => bad('q') }).svc.summarizeAndFollowUpFromLastTurn('p', item)).failures).toEqual([{ reason: 'summary-failed', detail: 'q' }]);
    expect((await make({ runSummary: async () => ok('zzz') }).svc.summarizeAndFollowUpFromLastTurn('p', item)).failures).toEqual([{ reason: 'unparseable' }]);
    expect((await make({ runSummary: async () => { throw new Error('t'); } }).svc.summarizeAndFollowUpFromLastTurn('p', item)).failures).toEqual([{ reason: 'summary-failed', detail: 't' }]);
    expect(await make().svc.summarizeAndFollowUpFromLastTurn('p', item)).toEqual({ summarized: 1, followedUp: 1 });
  });
});
