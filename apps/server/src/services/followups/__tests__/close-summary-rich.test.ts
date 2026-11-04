import { describe, expect, it, vi } from 'vitest';
import { CloseSummaryService, type CloseSummaryDeps, type SessionCloseNote } from '../close-summary.js';
import type { LlmRunResult } from '@zana-ai/zcc-domain/product';

const ok = (text: string): LlmRunResult => ({ ok: true, text, provider: 'claude-cli', ms: 1 });
const bad = (error: string): LlmRunResult => ({ ok: false, text: '', error, provider: 'claude-cli', ms: 1 });

function makeDeps(over: Partial<CloseSummaryDeps> = {}) {
  const log = vi.fn();
  const appendInbox = vi.fn(async (_input: Parameters<CloseSummaryDeps['appendInbox']>[0]) => ({ id: 'e1' }));
  const createFollowUp = vi.fn(async (_input: { projectId: string; sessionId: string; title: string; detail?: string }) => 'f1' as string | null);
  const readDigest = vi.fn(async () => 'user: hi\nassistant: done');
  const runSessionSummary = vi.fn(async (_digest: string, _key: string) => ok('## Did\n- a\n\nUnfinished: no\nAsks the user: no'));
  const getSession = vi.fn(() => ({ projectId: 'p', profile: 'claude', cwd: '/x', title: 'Agent' }) as ReturnType<CloseSummaryDeps['getSession']>);
  const hasTranscript = vi.fn(() => true);
  const deps: CloseSummaryDeps = {
    getSession,
    hasTranscript,
    readLastTurn: async () => '',
    runSummary: async () => ok('{}'),
    runTurnSummary: async () => ok('t'),
    readDigest,
    runSessionSummary,
    appendInbox,
    projectLabel: () => 'Proj',
    createFollowUp,
    log,
    ...over
  };
  return { svc: new CloseSummaryService(deps), log, appendInbox, createFollowUp, readDigest, runSessionSummary, getSession, hasTranscript };
}

const note = (over: Partial<SessionCloseNote> = {}): SessionCloseNote => ({ body: '## Did\n- a', unfinished: false, asksUser: false, ...over });

describe('summarizeForClose', () => {
  it('is ineligible for a foreign project, a missing session and a profile without a transcript', async () => {
    expect(await makeDeps({ getSession: () => ({ projectId: 'other', profile: 'claude', cwd: '/x', title: 'T' }) }).svc.summarizeForClose('p', 's')).toEqual({ ok: false, reason: 'ineligible' });
    expect(await makeDeps({ getSession: () => null }).svc.summarizeForClose('p', 's')).toEqual({ ok: false, reason: 'ineligible' });
    const { svc, readDigest } = makeDeps({ hasTranscript: () => false });
    expect(await svc.summarizeForClose('p', 's')).toEqual({ ok: false, reason: 'ineligible' });
    expect(readDigest).not.toHaveBeenCalled();
  });

  it('is empty for a blank digest and never calls the model', async () => {
    const { svc, runSessionSummary } = makeDeps({ readDigest: async () => '  \n ' });
    expect(await svc.summarizeForClose('p', 's')).toEqual({ ok: false, reason: 'empty' });
    expect(runSessionSummary).not.toHaveBeenCalled();
  });

  it('is summary-failed for a failed, empty or throwing model reply, logging the detail', async () => {
    const failed = makeDeps({ runSessionSummary: async () => bad('boom') });
    expect(await failed.svc.summarizeForClose('p', 's')).toEqual({ ok: false, reason: 'summary-failed' });
    expect(failed.log).toHaveBeenCalledWith('close-summary', 'summary-failed project=p session=s: boom');
    const empty = makeDeps({ runSessionSummary: async () => ok('Unfinished: no\nAsks the user: no') });
    expect(await empty.svc.summarizeForClose('p', 's')).toEqual({ ok: false, reason: 'summary-failed' });
    const noDetail = makeDeps({ runSessionSummary: async () => bad('') });
    await noDetail.svc.summarizeForClose('p', 's');
    expect(noDetail.log).toHaveBeenCalledWith('close-summary', 'summary-failed project=p session=s: no detail');
    const thrown = makeDeps({ readDigest: async () => { throw new Error('spawn EACCES'); } });
    expect(await thrown.svc.summarizeForClose('p', 's')).toEqual({ ok: false, reason: 'summary-failed' });
    expect(thrown.log).toHaveBeenCalledWith('close-summary', 'summary-failed project=p session=s: spawn EACCES');
  });

  it('parses both sentinels off the reply and returns the session title', async () => {
    const { svc, readDigest } = makeDeps({ runSessionSummary: async () => ok('## Did\n- a\n\nUnfinished: yes\nAsks the user: yes') });
    expect(await svc.summarizeForClose('p', 's')).toEqual({
      ok: true,
      title: 'Agent',
      note: { body: '## Did\n- a', unfinished: true, asksUser: true }
    });
    expect(readDigest).toHaveBeenCalledWith(expect.objectContaining({ id: 's', profile: 'claude', cwd: '/x' }));
  });

  it('defaults a reply without sentinels to unfinished and not asking', async () => {
    const { svc } = makeDeps({ runSessionSummary: async () => ok('## Did\n- a') });
    expect(await svc.summarizeForClose('p', 's')).toMatchObject({ ok: true, note: { unfinished: true, asksUser: false } });
  });

  it('uses opts.digest and opts.title without touching the session deps', async () => {
    const { svc, getSession, hasTranscript, readDigest } = makeDeps({
      getSession: () => null,
      hasTranscript: () => false,
      readDigest: async () => ''
    });
    const res = await svc.summarizeForClose('p', 's', { digest: 'thread digest', title: 'Thread' });
    expect(res).toMatchObject({ ok: true, title: 'Thread' });
    expect(getSession).not.toHaveBeenCalled();
    expect(hasTranscript).not.toHaveBeenCalled();
    expect(readDigest).not.toHaveBeenCalled();
  });

  it('falls back to the session id as title and still reports an empty opts.digest', async () => {
    const { svc, runSessionSummary } = makeDeps();
    expect(await svc.summarizeForClose('p', 'sess-1', { digest: 'x' })).toMatchObject({ ok: true, title: 'sess-1' });
    expect(runSessionSummary).toHaveBeenCalledWith('x', 'close-session-summary:sess-1');
    expect(await svc.summarizeForClose('p', 'sess-1', { digest: ' ' })).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('recordClose', () => {
  it.each([
    ['wrapped', '_Closed after it wrapped up._'],
    ['waiting-on-prompt', '_Closed without a wrap-up: it was waiting on a prompt._'],
    ['no-wrap-up', '_Closed without a wrap-up._']
  ] as const)('writes the exact inbox entry for %s', async (how, line) => {
    const { svc, appendInbox, createFollowUp } = makeDeps();
    const res = await svc.recordClose('p', 's1', '<command-name>/fix</command-name>  Agent', note({ body: '# Top\n## Did\n- a' }), how);
    expect(res).toEqual({ summarized: 1, followedUp: 0 });
    expect(appendInbox).toHaveBeenCalledWith({
      projectId: 'p',
      projectLabel: 'Proj',
      sessionId: 's1',
      comments: `### /fix Agent\n\n${line}\n\n## Top\n### Did\n- a`
    });
    expect(createFollowUp).not.toHaveBeenCalled();
  });

  it('files a follow-up titled by the first Left / next item when unfinished', async () => {
    const { svc, createFollowUp } = makeDeps();
    const body = '## Did\n- a\n\n## Left / next\n- **Ship** the thing\n- other';
    const res = await svc.recordClose('p', 's1', 'Agent', note({ body, unfinished: true }), 'wrapped');
    expect(res).toEqual({ summarized: 1, followedUp: 1 });
    expect(createFollowUp).toHaveBeenCalledWith({
      projectId: 'p',
      sessionId: 's1',
      title: 'Ship the thing',
      detail: `From **Agent**\n\n${body}\n\n_Filed when the agent was closed after a wrap-up._`
    });
  });

  it('uses the fallback title when there is no Left / next item', async () => {
    const { svc, createFollowUp } = makeDeps();
    await svc.recordClose('p', 's1', 'Agent', note({ unfinished: true }), 'no-wrap-up');
    expect(createFollowUp).toHaveBeenCalledWith(expect.objectContaining({ title: 'Follow up: Agent' }));
  });

  it('skips the follow-up when no createFollowUp dep is wired', async () => {
    const { svc } = makeDeps({ createFollowUp: undefined });
    expect(await svc.recordClose('p', 's1', 'Agent', note({ unfinished: true }), 'wrapped')).toEqual({ summarized: 1, followedUp: 0 });
  });

  it('reports write-failed without counting when createFollowUp returns null (already logged by the host)', async () => {
    const { svc, log } = makeDeps({ createFollowUp: async () => null });
    const res = await svc.recordClose('p', 's1', 'Agent', note({ unfinished: true }), 'wrapped');
    expect(res).toEqual({ summarized: 1, followedUp: 0, failures: [{ reason: 'write-failed', detail: 'the follow-up was not created' }] });
    expect(log).not.toHaveBeenCalled();
  });

  it('reports write-failed when createFollowUp throws', async () => {
    const { svc, log } = makeDeps({ createFollowUp: async () => { throw new Error('db locked'); } });
    const res = await svc.recordClose('p', 's1', 'Agent', note({ unfinished: true }), 'wrapped');
    expect(res).toEqual({ summarized: 1, followedUp: 0, failures: [{ reason: 'write-failed', detail: 'db locked' }] });
    expect(log).toHaveBeenCalledWith('close-summary', 'write-failed: db locked');
  });

  it('still files the follow-up when the inbox append throws', async () => {
    const { svc, createFollowUp } = makeDeps({ appendInbox: async () => { throw new Error('disk full'); } });
    const res = await svc.recordClose('p', 's1', 'Agent', note({ unfinished: true }), 'wrapped');
    expect(res).toEqual({ summarized: 0, followedUp: 1, failures: [{ reason: 'write-failed', detail: 'disk full' }] });
    expect(createFollowUp).toHaveBeenCalled();
  });
});

describe('recordKeptOpen', () => {
  it.each([
    ['asks-you', '_Still open: it asked you something while wrapping up. Answer it, then close it again._'],
    ['timeout', '_Still open: it was still working 15 minutes after you chose Close with follow-up, so it was left running._'],
    ['turn-error', '_Still open: the wrap-up turn ended with an error._']
  ] as const)('writes the exact entry for %s, with and without a note', async (reason, line) => {
    const { svc, appendInbox, createFollowUp } = makeDeps();
    expect(await svc.recordKeptOpen('p', 's1', 'Agent', reason)).toEqual({ recorded: 1 });
    expect(appendInbox).toHaveBeenLastCalledWith({ projectId: 'p', projectLabel: 'Proj', sessionId: 's1', comments: `### Agent\n\n${line}` });
    await svc.recordKeptOpen('p', 's1', 'Agent', reason, note({ body: '## Did\n- a', unfinished: true }));
    expect(appendInbox).toHaveBeenLastCalledWith({ projectId: 'p', projectLabel: 'Proj', sessionId: 's1', comments: `### Agent\n\n${line}\n\n### Did\n- a` });
    expect(createFollowUp).not.toHaveBeenCalled();
  });

  it('reports write-failed when the inbox append throws', async () => {
    const { svc } = makeDeps({ appendInbox: async () => { throw new Error('disk full'); } });
    expect(await svc.recordKeptOpen('p', 's1', 'Agent', 'timeout')).toEqual({ recorded: 0, failures: [{ reason: 'write-failed', detail: 'disk full' }] });
  });
});
