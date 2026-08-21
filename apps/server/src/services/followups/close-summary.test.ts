import { describe, it, expect, vi } from 'vitest';
import {
  CloseSummaryService,
  parseCloseSummary,
  renderCloseSummary,
  renderSessionSummary,
  type CloseSummaryDeps,
  type CloseSummarySessionInfo
} from './close-summary.js';
import type { LlmRunResult } from '@zana-ai/zcc-domain/product';

describe('parseCloseSummary', () => {
  it('parses a clean JSON reply', () => {
    expect(parseCloseSummary('{"did":"Fixed the login redirect","left":"Tests still failing"}')).toEqual({
      did: 'Fixed the login redirect',
      left: 'Tests still failing'
    });
  });

  it('tolerates surrounding prose / code fences', () => {
    const out = parseCloseSummary('```json\n{"did":"Refactored store","left":""}\n```');
    expect(out).toEqual({ did: 'Refactored store', left: '' });
  });

  it('caps did/left length at 100', () => {
    const out = parseCloseSummary(`{"did":"${'x'.repeat(200)}","left":"${'y'.repeat(200)}"}`);
    expect(out?.did.length).toBe(100);
    expect(out?.left.length).toBe(100);
  });

  it('returns null when both fields are empty', () => {
    expect(parseCloseSummary('{"did":"","left":""}')).toBeNull();
  });

  it('returns null on non-JSON / empty', () => {
    expect(parseCloseSummary('not json')).toBeNull();
    expect(parseCloseSummary('')).toBeNull();
  });
});

describe('renderCloseSummary', () => {
  it('renders a header + one section per agent, omitting empty Left', () => {
    const md = renderCloseSummary('My Project', [
      { sessionId: 'a', title: 'Fix login', note: { did: 'Patched redirect', left: 'Awaiting review' } },
      { sessionId: 'b', title: 'Refactor', note: { did: 'Split the store', left: '' } }
    ]);
    expect(md).toContain('Closed 2 idle agents in **My Project**.');
    expect(md).toContain('### Fix login');
    expect(md).toContain('**Did:** Patched redirect');
    expect(md).toContain('**Left:** Awaiting review');
    expect(md).toContain('### Refactor');
    // The second agent has no "left", so no Left line for it.
    expect(md.match(/\*\*Left:\*\*/g)).toHaveLength(1);
  });

  it('uses singular wording for one agent', () => {
    const md = renderCloseSummary('P', [{ sessionId: 'a', title: 'a', note: { did: 'x', left: '' } }]);
    expect(md).toContain('Closed 1 idle agent in **P**.');
  });

  it('uses a "Caught up on" header (not "Closed") for the read-only path', () => {
    const md = renderCloseSummary(
      'P',
      [{ sessionId: 'a', title: 'a', note: { did: 'x', left: '' } }],
      { closing: false }
    );
    expect(md).toContain('Caught up on 1 agent in **P**.');
    expect(md).not.toContain('Closed');
  });
});

describe('renderSessionSummary', () => {
  it('titles the agent and keeps the model’s Markdown body', () => {
    const md = renderSessionSummary(
      'Fix login',
      '**Goal** — fix the redirect\n\n- Patched the handler\n- Added a test'
    );
    expect(md).toContain('### Fix login');
    expect(md).toContain('**Goal** — fix the redirect');
    expect(md).toContain('- Patched the handler');
  });

  it('demotes the model’s own headings one level so they nest under the title', () => {
    const md = renderSessionSummary('Refactor', '## Goal\n\nSplit the store\n\n### What it did\n\n- done');
    expect(md.startsWith('### Refactor')).toBe(true);
    // A top-level `## Goal` from the model becomes `### Goal`, never out-ranking
    // the `### Refactor` title.
    expect(md).toContain('### Goal');
    expect(md).toContain('#### What it did');
    expect(md).not.toMatch(/\n## Goal/);
  });
});

describe('CloseSummaryService.summarizeOne', () => {
  const session = (over: Partial<CloseSummarySessionInfo> = {}): CloseSummarySessionInfo => ({
    projectId: 'p1',
    profile: 'claude',
    cwd: '/proj',
    claudeSessionId: 'cs',
    title: 'Agent',
    ...over
  });
  const okResult = (text: string): LlmRunResult => ({ ok: true, text, provider: 'claude-cli', ms: 1 });

  function makeDeps(over: Partial<CloseSummaryDeps> = {}): CloseSummaryDeps {
    return {
      getSession: () => session(),
      hasTranscript: (p) => p === 'claude',
      readLastTurn: vi.fn(async () => 'I finished the task.'),
      runSummary: vi.fn(async () => okResult('{"did":"did the thing","left":"wrote tests"}')),
      runTurnSummary: vi.fn(async () => okResult('It finished the refactor and asked whether to delete the old file.')),
      readDigest: vi.fn(async () => 'User: do the thing\n\nAssistant: I did the thing.'),
      runSessionSummary: vi.fn(async () =>
        okResult('**Goal** — do the thing\n\n- Did the thing\n- Wrote tests')
      ),
      appendInbox: vi.fn(async () => ({ id: 'entry-9' })),
      projectLabel: () => 'Proj One',
      ...over
    };
  }

  it('summarizes one live agent (full digest, richer prompt) and links the entry', async () => {
    const deps = makeDeps();
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarizeOne('p1', 's1');
    expect(res).toEqual({ ok: true, entryId: 'entry-9' });
    // Uses the whole-session digest + the richer summary prompt, NOT the terse
    // last-turn close note.
    expect(deps.readDigest).toHaveBeenCalled();
    expect(deps.runSessionSummary).toHaveBeenCalled();
    expect(deps.readLastTurn).not.toHaveBeenCalled();
    expect(deps.runSummary).not.toHaveBeenCalled();
    const arg = (deps.appendInbox as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.sessionId).toBe('s1');
    expect(arg.projectId).toBe('p1');
    expect(arg.comments).toContain('### Agent');
    expect(arg.comments).toContain('Did the thing');
    // Single-agent framing — NOT the "Closed N idle agents" digest header.
    expect(arg.comments).not.toContain('Closed');
  });

  it('rejects a foreign/gone/non-claude session as ineligible (no read, no write)', async () => {
    const foreign = makeDeps({ getSession: () => session({ projectId: 'other' }) });
    expect(await new CloseSummaryService(foreign).summarizeOne('p1', 's1')).toEqual({
      ok: false,
      reason: 'ineligible'
    });
    expect(foreign.readDigest).not.toHaveBeenCalled();
    expect(foreign.appendInbox).not.toHaveBeenCalled();

    const gone = makeDeps({ getSession: () => null });
    expect(await new CloseSummaryService(gone).summarizeOne('p1', 's1')).toEqual({
      ok: false,
      reason: 'ineligible'
    });

    const shell = makeDeps({ getSession: () => session({ profile: 'shell' }) });
    expect(await new CloseSummaryService(shell).summarizeOne('p1', 's1')).toEqual({
      ok: false,
      reason: 'ineligible'
    });
  });

  it('reports empty when the transcript has no text yet (no call spent)', async () => {
    const deps = makeDeps({ readDigest: vi.fn(async () => '   ') });
    const res = await new CloseSummaryService(deps).summarizeOne('p1', 's1');
    expect(res).toEqual({ ok: false, reason: 'empty' });
    expect(deps.runSessionSummary).not.toHaveBeenCalled();
    expect(deps.appendInbox).not.toHaveBeenCalled();
  });

  it('reports summary-failed on an LLM error or an empty reply', async () => {
    const llmErr = makeDeps({
      runSessionSummary: vi.fn(
        async (): Promise<LlmRunResult> => ({
          ok: false,
          text: '',
          error: 'boom',
          provider: 'claude-cli',
          ms: 1
        })
      )
    });
    expect((await new CloseSummaryService(llmErr).summarizeOne('p1', 's1'))).toEqual({
      ok: false,
      reason: 'summary-failed'
    });

    const blank = makeDeps({ runSessionSummary: vi.fn(async () => okResult('   ')) });
    expect(await new CloseSummaryService(blank).summarizeOne('p1', 's1')).toEqual({
      ok: false,
      reason: 'summary-failed'
    });
  });

  it('reports write-failed when the inbox append throws', async () => {
    const deps = makeDeps({
      appendInbox: vi.fn(async () => {
        throw new Error('disk full');
      })
    });
    const res = await new CloseSummaryService(deps).summarizeOne('p1', 's1');
    expect(res).toEqual({ ok: false, reason: 'write-failed' });
  });
});

describe('CloseSummaryService', () => {
  const session = (over: Partial<CloseSummarySessionInfo> = {}): CloseSummarySessionInfo => ({
    projectId: 'p1',
    profile: 'claude',
    cwd: '/proj',
    claudeSessionId: 'cs',
    title: 'Agent',
    ...over
  });

  const okResult = (text: string): LlmRunResult => ({ ok: true, text, provider: 'claude-cli', ms: 1 });

  function makeDeps(over: Partial<CloseSummaryDeps> = {}): CloseSummaryDeps {
    return {
      getSession: (id) => session({ title: id }),
      hasTranscript: (p) => p === 'claude',
      readLastTurn: vi.fn(async () => 'I finished the task.'),
      runSummary: vi.fn(async () => okResult('{"did":"did the thing","left":""}')),
      runTurnSummary: vi.fn(async () => okResult('Finished the refactor.')),
      readDigest: vi.fn(async () => 'User: x\n\nAssistant: y'),
      runSessionSummary: vi.fn(async () => okResult('- did the thing')),
      appendInbox: vi.fn(async () => ({ id: 'entry-1' })),
      projectLabel: () => 'Proj One',
      ...over
    };
  }

  it('summarizes eligible agents into one combined inbox entry', async () => {
    const deps = makeDeps();
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarize('p1', ['a', 'b']);
    expect(res).toMatchObject({ summarized: 2, entryId: 'entry-1' });
    // The rendered combined markdown is also returned (so callers can persist
    // the wrap-up beyond the inbox); it equals what was appended.
    expect(res.body).toContain('Closed 2 idle agents in **Proj One**.');
    expect(deps.appendInbox).toHaveBeenCalledTimes(1);
    const arg = (deps.appendInbox as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.projectId).toBe('p1');
    expect(arg.comments).toContain('Closed 2 idle agents in **Proj One**.');
  });

  it('skips sessions that do not belong to the project (confinement)', async () => {
    const deps = makeDeps({
      getSession: (id) => (id === 'foreign' ? session({ projectId: 'other' }) : session({ title: id }))
    });
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarize('p1', ['a', 'foreign']);
    expect(res.summarized).toBe(1);
    expect(deps.runSummary).toHaveBeenCalledTimes(1);
  });

  it('skips non-claude and gone sessions', async () => {
    const deps = makeDeps({
      getSession: (id) =>
        id === 'shell' ? session({ profile: 'shell' }) : id === 'gone' ? null : session({ title: id })
    });
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarize('p1', ['a', 'shell', 'gone']);
    expect(res.summarized).toBe(1);
  });

  it('drops an agent with no transcript text without spending a call', async () => {
    const readLastTurn = vi.fn(async (ref: { claudeSessionId?: string }) =>
      ref.claudeSessionId === 'cs-empty' ? '' : 'did stuff'
    );
    const deps = makeDeps({
      getSession: (id) => session({ title: id, claudeSessionId: id === 'empty' ? 'cs-empty' : 'cs' }),
      readLastTurn
    });
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarize('p1', ['good', 'empty']);
    expect(res.summarized).toBe(1);
    expect(deps.runSummary).toHaveBeenCalledTimes(1);
  });

  it('writes nothing and reports 0 when no agent yields a note', async () => {
    const deps = makeDeps({ readLastTurn: vi.fn(async () => '') });
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarize('p1', ['a', 'b']);
    expect(res).toEqual({ summarized: 0 });
    expect(deps.appendInbox).not.toHaveBeenCalled();
  });

  it('reports 0 when the inbox write fails (does not throw)', async () => {
    const deps = makeDeps({
      appendInbox: vi.fn(async () => {
        throw new Error('disk full');
      })
    });
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarize('p1', ['a']);
    expect(res).toEqual({ summarized: 0 });
  });

  it('bounds concurrent micro-calls (never more than 5 in flight)', async () => {
    let inFlight = 0;
    let peak = 0;
    const deps = makeDeps({
      getSession: (id) => session({ title: id }),
      runSummary: vi.fn(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return okResult('{"did":"x","left":""}');
      })
    });
    const svc = new CloseSummaryService(deps);
    const ids = Array.from({ length: 20 }, (_, i) => `a${i}`);
    const res = await svc.summarize('p1', ids);
    expect(res.summarized).toBe(20);
    expect(peak).toBeLessThanOrEqual(5);
  });

  it('is a no-op for an empty id list', async () => {
    const deps = makeDeps();
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarize('p1', []);
    expect(res).toEqual({ summarized: 0 });
    expect(deps.appendInbox).not.toHaveBeenCalled();
  });

  it('survives a single agent failure and still summarizes the rest', async () => {
    // The 'bad' agent's per-agent micro-call rejects; its sibling succeeds. The
    // service must swallow the failure (to null) and still write the survivor.
    const deps = makeDeps({
      getSession: (id) => session({ title: id }),
      runSummary: vi.fn(async (_lastTurn, dedupeKey) =>
        dedupeKey.endsWith('bad')
          ? Promise.reject(new Error('boom'))
          : okResult('{"did":"ok","left":""}')
      )
    });
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarize('p1', ['ok1', 'bad']);
    expect(res.summarized).toBe(1);
    expect(res.entryId).toBe('entry-1');
  });
});

describe('CloseSummaryService.summarizeAndClose', () => {
  const session = (over: Partial<CloseSummarySessionInfo> = {}): CloseSummarySessionInfo => ({
    projectId: 'p1',
    profile: 'claude',
    cwd: '/proj',
    claudeSessionId: 'cs',
    title: 'Agent',
    ...over
  });
  const okResult = (text: string): LlmRunResult => ({ ok: true, text, provider: 'claude-cli', ms: 1 });

  function makeDeps(over: Partial<CloseSummaryDeps> = {}): CloseSummaryDeps {
    return {
      getSession: (id) => session({ title: id }),
      hasTranscript: (p) => p === 'claude',
      readLastTurn: vi.fn(async () => 'done'),
      runSummary: vi.fn(async () => okResult('{"did":"x","left":""}')),
      runTurnSummary: vi.fn(async () => okResult('Finished the refactor.')),
      readDigest: vi.fn(async () => 'User: x\n\nAssistant: y'),
      runSessionSummary: vi.fn(async () => okResult('- did the thing')),
      appendInbox: vi.fn(async () => ({ id: 'entry-1' })),
      projectLabel: () => 'Proj One',
      closeTerminal: vi.fn(() => true),
      ...over
    };
  }

  it('summarizes then closes the confined sessions', async () => {
    const deps = makeDeps();
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarizeAndClose('p1', ['a', 'b']);
    expect(res).toMatchObject({ closed: 2, summarized: 2, entryId: 'entry-1' });
    expect(deps.appendInbox).toHaveBeenCalledTimes(1);
    expect(deps.closeTerminal).toHaveBeenCalledTimes(2);
  });

  it('skips the summary when summarize:false but still closes', async () => {
    const deps = makeDeps();
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarizeAndClose('p1', ['a'], { summarize: false });
    expect(res.summarized).toBe(0);
    expect(res.closed).toBe(1);
    expect(deps.runSummary).not.toHaveBeenCalled();
    expect(deps.appendInbox).not.toHaveBeenCalled();
    expect(deps.closeTerminal).toHaveBeenCalledWith('a');
  });

  it('does not close foreign/stale sessions (same confinement as summarize)', async () => {
    const deps = makeDeps({
      getSession: (id) => (id === 'foreign' ? session({ projectId: 'other' }) : id === 'gone' ? null : session()),
      closeTerminal: vi.fn(() => true)
    });
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarizeAndClose('p1', ['mine', 'foreign', 'gone'], { summarize: false });
    expect(res.closed).toBe(1);
    expect(deps.closeTerminal).toHaveBeenCalledTimes(1);
    expect(deps.closeTerminal).toHaveBeenCalledWith('mine');
  });

  it('closes even when the summary wrote nothing (summary failure never blocks close)', async () => {
    const deps = makeDeps({ readLastTurn: vi.fn(async () => '') }); // no transcript → summarized 0
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarizeAndClose('p1', ['a']);
    expect(res.summarized).toBe(0);
    expect(res.closed).toBe(1);
  });

  it('throws if closeTerminal was not wired (programmer error)', async () => {
    const deps = makeDeps({ closeTerminal: undefined });
    const svc = new CloseSummaryService(deps);
    await expect(svc.summarizeAndClose('p1', ['a'])).rejects.toThrow(/closeTerminal dep not wired/);
  });
});

describe('CloseSummaryService.summarizeAndFollowUp', () => {
  const session = (over: Partial<CloseSummarySessionInfo> = {}): CloseSummarySessionInfo => ({
    projectId: 'p1',
    profile: 'claude',
    cwd: '/proj',
    claudeSessionId: 'cs',
    title: 'Agent',
    ...over
  });
  const okResult = (text: string): LlmRunResult => ({ ok: true, text, provider: 'claude-cli', ms: 1 });

  function makeDeps(over: Partial<CloseSummaryDeps> = {}): CloseSummaryDeps {
    return {
      getSession: (id) => session({ title: id }),
      hasTranscript: (p) => p === 'claude',
      readLastTurn: vi.fn(async () => 'done'),
      // Default: agent left unfinished work → a follow-up should be filed.
      runSummary: vi.fn(async () => okResult('{"did":"Fixed X","left":"Tests failing"}')),
      runTurnSummary: vi.fn(async () => okResult('note')),
      readDigest: vi.fn(async () => 'x'),
      runSessionSummary: vi.fn(async () => okResult('y')),
      appendInbox: vi.fn(async () => ({ id: 'entry-1' })),
      projectLabel: () => 'Proj One',
      createFollowUp: vi.fn(() => 'followup-1'),
      ...over
    };
  }

  it('folds all agents into ONE combined inbox entry AND files a follow-up when work is left', async () => {
    const deps = makeDeps();
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarizeAndFollowUp('p1', ['a', 'b']);
    expect(res).toEqual({ summarized: 2, followedUp: 2 });
    // ONE combined digest for the whole batch — NOT a per-agent breadcrumb storm.
    expect(deps.appendInbox).toHaveBeenCalledTimes(1);
    const arg = (deps.appendInbox as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.comments).toContain('Closed 2 idle agents in **Proj One**.');
    // The combined digest belongs to no single session.
    expect(arg.sessionId).toBeUndefined();
    // A follow-up per agent that left work (both did, in the default deps).
    expect(deps.createFollowUp).toHaveBeenCalledTimes(2);
  });

  it('writes the digest but NO follow-up when every agent finished (left empty)', async () => {
    const deps = makeDeps({
      runSummary: vi.fn(async () => okResult('{"did":"Shipped it","left":""}'))
    });
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarizeAndFollowUp('p1', ['a']);
    expect(res).toEqual({ summarized: 1, followedUp: 0 });
    expect(deps.appendInbox).toHaveBeenCalledTimes(1);
    expect(deps.createFollowUp).not.toHaveBeenCalled();
  });

  it('confines to the project — foreign/stale/non-claude ids are dropped', async () => {
    const deps = makeDeps({
      getSession: (id) =>
        id === 'foreign'
          ? session({ projectId: 'other' })
          : id === 'gone'
            ? null
            : id === 'shell'
              ? session({ profile: 'shell' })
              : session({ title: id })
    });
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarizeAndFollowUp('p1', ['mine', 'foreign', 'gone', 'shell']);
    expect(res).toEqual({ summarized: 1, followedUp: 1 });
    expect(deps.createFollowUp).toHaveBeenCalledTimes(1);
  });

  it('never throws — an inbox write failure still lets the follow-up be filed', async () => {
    const deps = makeDeps({
      appendInbox: vi.fn(async () => {
        throw new Error('inbox down');
      })
    });
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarizeAndFollowUp('p1', ['a']);
    // The combined digest failed (summarized 0) but the follow-up still went in.
    expect(res).toEqual({ summarized: 0, followedUp: 1 });
  });

  it('no inbox entry and no follow-up when nothing distilled (unparseable summary)', async () => {
    const deps = makeDeps({ runSummary: vi.fn(async () => okResult('not json')) });
    const svc = new CloseSummaryService(deps);
    const res = await svc.summarizeAndFollowUp('p1', ['a']);
    expect(res).toEqual({ summarized: 0, followedUp: 0 });
    // No distilled note ⇒ no digest written (no bare "closed" noise anymore).
    expect(deps.appendInbox).not.toHaveBeenCalled();
    expect(deps.createFollowUp).not.toHaveBeenCalled();
  });
});

describe('CloseSummaryService.summarizeTurn', () => {
  const session = (over: Partial<CloseSummarySessionInfo> = {}): CloseSummarySessionInfo => ({
    projectId: 'p1',
    profile: 'claude',
    cwd: '/proj',
    claudeSessionId: 'cs',
    title: 'Agent',
    ...over
  });
  const okResult = (text: string): LlmRunResult => ({ ok: true, text, provider: 'claude-cli', ms: 1 });

  function makeDeps(over: Partial<CloseSummaryDeps> = {}): CloseSummaryDeps {
    return {
      getSession: () => session(),
      hasTranscript: (p) => p === 'claude',
      readLastTurn: vi.fn(async () => 'I finished the refactor. Should I delete the old file?'),
      runSummary: vi.fn(async () => okResult('{"did":"x","left":""}')),
      runTurnSummary: vi.fn(async () => okResult('Finished the refactor. Asks whether to delete the old file.')),
      readDigest: vi.fn(async () => 'digest'),
      runSessionSummary: vi.fn(async () => okResult('summary')),
      appendInbox: vi.fn(async () => ({ id: 'e1' })),
      projectLabel: () => 'Proj One',
      ...over
    };
  }

  it('returns the turn summary text on success (reads last turn, runs turn prompt, no inbox)', async () => {
    const deps = makeDeps();
    const res = await new CloseSummaryService(deps).summarizeTurn('p1', 's1');
    expect(res).toEqual({ ok: true, text: 'Finished the refactor. Asks whether to delete the old file.' });
    expect(deps.readLastTurn).toHaveBeenCalled();
    expect(deps.runTurnSummary).toHaveBeenCalledWith(
      'I finished the refactor. Should I delete the old file?',
      'turn-summary:s1'
    );
    // Pure read+summarize — never the inbox or the whole-session digest path.
    expect(deps.appendInbox).not.toHaveBeenCalled();
    expect(deps.readDigest).not.toHaveBeenCalled();
    expect(deps.runSessionSummary).not.toHaveBeenCalled();
  });

  it('returns {ok:false} for a foreign / gone / non-claude session (no read)', async () => {
    const foreign = makeDeps({ getSession: () => session({ projectId: 'other' }) });
    expect(await new CloseSummaryService(foreign).summarizeTurn('p1', 's1')).toEqual({ ok: false });
    expect(foreign.readLastTurn).not.toHaveBeenCalled();

    const gone = makeDeps({ getSession: () => null });
    expect(await new CloseSummaryService(gone).summarizeTurn('p1', 's1')).toEqual({ ok: false });

    const shell = makeDeps({ getSession: () => session({ profile: 'shell' }) });
    expect(await new CloseSummaryService(shell).summarizeTurn('p1', 's1')).toEqual({ ok: false });
  });

  it('returns {ok:false} on an empty/unreadable last turn (no micro-call spent)', async () => {
    const deps = makeDeps({ readLastTurn: vi.fn(async () => '   ') });
    expect(await new CloseSummaryService(deps).summarizeTurn('p1', 's1')).toEqual({ ok: false });
    expect(deps.runTurnSummary).not.toHaveBeenCalled();
  });

  it('returns {ok:false} when the micro-call fails or yields empty text', async () => {
    const failed = makeDeps({
      runTurnSummary: vi.fn(
        async (): Promise<LlmRunResult> => ({ ok: false, text: '', error: 'boom', provider: 'claude-cli', ms: 1 })
      )
    });
    expect(await new CloseSummaryService(failed).summarizeTurn('p1', 's1')).toEqual({ ok: false });

    const blank = makeDeps({ runTurnSummary: vi.fn(async () => okResult('   ')) });
    expect(await new CloseSummaryService(blank).summarizeTurn('p1', 's1')).toEqual({ ok: false });
  });

  it('swallows a thrown reader/micro-call to {ok:false} (never throws)', async () => {
    const deps = makeDeps({
      readLastTurn: vi.fn(async () => {
        throw new Error('disk');
      })
    });
    await expect(new CloseSummaryService(deps).summarizeTurn('p1', 's1')).resolves.toEqual({ ok: false });
  });
});
