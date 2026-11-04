import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_CLOSE_WRAP_UP_INSTRUCTIONS } from '@zana-ai/zcc-domain/product';
import { createWrapUpClose } from '../wrap-up-close-wiring.js';

function make(over: { suppress?: boolean; cfg?: () => unknown; session?: unknown; remote?: boolean; transcript?: boolean } = {}) {
  const session = over.session === undefined
    ? { projectId: 'p', profile: 'claude', status: 'running', title: 'T', lastKeyInputAt: 7, draftPending: true }
    : over.session;
  const note = { body: 'b', unfinished: false, asksUser: false };
  const deps = {
    store: { getConfig: vi.fn(over.cfg ?? (() => ({}))) as never },
    ptys: { getSession: vi.fn(() => session as never), reply: vi.fn(() => true) },
    agentStatus: { get: vi.fn(() => 'idle'), markBlocked: vi.fn() },
    closeSummary: {
      summarizeForClose: vi.fn(async () => ({ ok: true as const, title: 'T', note })),
      recordClose: vi.fn(async () => ({ summarized: 1 as const, followedUp: 0 as const })),
      recordKeptOpen: vi.fn(async () => ({ recorded: 1 as const }))
    },
    providerCapabilities: vi.fn(() => ({ hasTranscript: over.transcript ?? true })),
    isRemoteSession: vi.fn(() => over.remote ?? false),
    suppressesInteractiveBlocked: vi.fn(() => over.suppress ?? false)
  };
  return { deps, note };
}

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('createWrapUpClose', () => {
  it('reads the instructions live, falling back to the default, and types them as one line', async () => {
    const { deps } = make({ session: { projectId: 'p', profile: 'claude', status: 'running', title: 'T' } });
    const getConfig = deps.store.getConfig as unknown as ReturnType<typeof vi.fn>;
    getConfig.mockReturnValue({});
    const service = createWrapUpClose(deps);
    void service.run('p', ['s1']);
    expect(deps.ptys.reply).toHaveBeenLastCalledWith('s1', DEFAULT_CLOSE_WRAP_UP_INSTRUCTIONS.replace(/\s+/g, ' ').trim());
    service.forget('s1');
    getConfig.mockReturnValue({ closeWrapUpInstructions: 'Be\nbrief' });
    void service.run('p', ['s1']);
    expect(deps.ptys.reply).toHaveBeenLastCalledWith('s1', 'Be brief');
    service.forget('s1');
  });

  it('maps lastKeyInputAt, draftPending and the remote flag from the pty session', async () => {
    const { deps } = make({ remote: false });
    const service = createWrapUpClose(deps);
    // A pending draft at the click keeps it open as typed, proving the field is mapped.
    expect(await service.run('p', ['s1'])).toEqual({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'typed' }] });
    expect(deps.isRemoteSession).toHaveBeenCalled();
    expect(deps.ptys.reply).not.toHaveBeenCalled();
  });

  it('never types into a remote session and records no-wrap-up through closeSummary', async () => {
    const { deps, note } = make({ remote: true });
    const service = createWrapUpClose(deps);
    expect(await service.run('p', ['s1'])).toEqual({ summarized: 1, followedUp: 0, keptOpen: [] });
    expect(deps.ptys.reply).not.toHaveBeenCalled();
    expect(deps.closeSummary.summarizeForClose).toHaveBeenCalledWith('p', 's1');
    expect(deps.closeSummary.recordClose).toHaveBeenCalledWith('p', 's1', 'T', note, 'no-wrap-up');
  });

  it('types only into Claude-family profiles', async () => {
    for (const [profile, typed] of [['claude', true], ['claude-yolo', true], ['codex', false], ['opencode', false]] as const) {
      const { deps } = make({ session: { projectId: 'p', profile, status: 'running', title: 'T' } });
      const service = createWrapUpClose(deps);
      void service.run('p', ['s1']);
      expect(deps.ptys.reply).toHaveBeenCalledTimes(typed ? 1 : 0);
      service.forget('s1');
    }
  });

  it('takes hasTranscript from providerCapabilities and skips a profile without one', async () => {
    const { deps } = make({ transcript: false });
    const service = createWrapUpClose(deps);
    expect(await service.run('p', ['s1'])).toEqual({ summarized: 0, followedUp: 0, keptOpen: [] });
    expect(deps.providerCapabilities).toHaveBeenCalledWith('claude');
  });

  it('skips a session that is gone', async () => {
    const { deps } = make({ session: null });
    expect(await createWrapUpClose(deps).run('p', ['s1'])).toEqual({ summarized: 0, followedUp: 0, keptOpen: [] });
  });

  it('marks needs-you when the agent asks, unless the session is a headless worker', async () => {
    for (const suppress of [false, true]) {
      const { deps, note } = make({ suppress, session: { projectId: 'p', profile: 'claude', status: 'running', title: 'T' } });
      deps.closeSummary.summarizeForClose = vi.fn(async () => ({ ok: true as const, title: 'T', note: { ...note, asksUser: true } }));
      const service = createWrapUpClose(deps);
      const p = service.run('p', ['s1']);
      service.observe('s1', 'working');
      service.observe('s1', 'idle');
      await vi.advanceTimersByTimeAsync(5000);
      expect(await p).toMatchObject({ keptOpen: [{ sessionId: 's1', reason: 'asks-you' }] });
      expect(deps.agentStatus.markBlocked).toHaveBeenCalledTimes(suppress ? 0 : 1);
      expect(deps.closeSummary.recordKeptOpen).toHaveBeenCalled();
    }
  });

  it('does not mark a session that went away during the summary', async () => {
    let gone = false;
    const live = { projectId: 'p', profile: 'claude', status: 'running', title: 'T' };
    const { deps, note } = make({ session: live });
    deps.ptys.getSession = vi.fn(() => (gone ? null : live) as never);
    deps.closeSummary.summarizeForClose = vi.fn(async () => {
      gone = true;
      return { ok: true as const, title: 'T', note: { ...note, asksUser: true } };
    });
    const service = createWrapUpClose(deps);
    const p = service.run('p', ['s1']);
    service.observe('s1', 'working');
    service.observe('s1', 'idle');
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(deps.agentStatus.markBlocked).not.toHaveBeenCalled();
    expect(deps.suppressesInteractiveBlocked).not.toHaveBeenCalled();
  });
});
