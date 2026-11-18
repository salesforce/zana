import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { agentTabStatus, isListedAgent } from '../lib/agent-tab-status.js';

const restore = vi.fn();
const close = vi.fn();

vi.mock('../lib/product-client.js', () => ({
  product: {
    terminals: {
      restore: (...args: unknown[]) => restore(...args),
      close: (...args: unknown[]) => close(...args)
    },
    threads: { list: vi.fn().mockResolvedValue([]) },
    git: { status: vi.fn().mockRejectedValue(new Error('no git')) }
  }
}));

const session = (id: string, over: Partial<TerminalSession> = {}) =>
  ({
    id,
    projectId: 'p1',
    title: id,
    profile: 'claude',
    cwd: '/tmp/p',
    status: 'running',
    createdAt: 1,
    ...over
  }) as TerminalSession;

const agentTab = (sessionId: string, projectScoped = false) =>
  ({ kind: 'agent', sessionId, projectId: 'p1', projectScoped }) as const;

async function load() {
  const { useData } = await import('../store.js');
  const tabs = await import('../lib/application-tabs.js');
  const resume = await import('../lib/agent-tab-resume.js');
  return { useData, ...tabs, ...resume };
}

beforeAll(async () => {
  await import('../store.js');
}, 20_000);

beforeEach(() => {
  vi.resetModules();
  restore.mockReset();
  close.mockReset().mockResolvedValue(true);
});

describe('agentTabStatus', () => {
  it('maps lifecycle and agent state to the thread-tab status words', () => {
    expect(agentTabStatus({ status: 'starting' }, undefined)).toBe('Working');
    expect(agentTabStatus({ status: 'running' }, 'working')).toBe('Working');
    expect(agentTabStatus({ status: 'running' }, 'blocked')).toBe('Needs you');
    expect(agentTabStatus({ status: 'running' }, 'idle')).toBe('Idle');
    expect(agentTabStatus({ status: 'running' }, undefined)).toBe('Idle');
    expect(agentTabStatus({ status: 'running' }, 'unknown')).toBe('Idle');
    expect(agentTabStatus({ status: 'exited', exitCode: 0 }, 'working')).toBe('Exited');
    expect(agentTabStatus({ status: 'exited' }, undefined)).toBe('Exited');
    expect(agentTabStatus({ status: 'exited', exitCode: 3 }, undefined)).toBe('Error');
  });
  it('lists everything except scheduled jobs and provider sign-in shells', () => {
    expect(isListedAgent(undefined)).toBe(false);
    expect(isListedAgent(session('a'))).toBe(true);
    expect(isListedAgent(session('a', { scheduled: true }))).toBe(false);
    expect(isListedAgent(session('a', { providerSignIn: { providerId: 'x' } }))).toBe(false);
  });
});

describe('withAgentTabReplace', () => {
  it('marks the old id in flight, swaps the tab in place and clears the mark', async () => {
    const { useApplicationTabs, withAgentTabReplace, resumingAgents, applicationTabId } = await load();
    useApplicationTabs.setState({
      open: [agentTab('x'), agentTab('old', true), agentTab('y')],
      closed: []
    });
    let during = false;
    const next = await withAgentTabReplace('old', 'p1', async () => {
      during = resumingAgents.has('old');
      return { id: 'new' };
    });
    expect(next).toEqual({ id: 'new' });
    expect(during).toBe(true);
    expect(resumingAgents.has('old')).toBe(false);
    const open = useApplicationTabs.getState().open;
    expect(open.map(applicationTabId)).toEqual(['agent:x', 'agent:new', 'agent:y']);
    expect(open[1]).toMatchObject({ projectScoped: true });
  });
  it('keeps the tab and clears the mark when the restart fails, returns null or throws', async () => {
    const { useApplicationTabs, withAgentTabReplace, resumingAgents, applicationTabId } = await load();
    useApplicationTabs.setState({ open: [agentTab('old')], closed: [] });
    expect(await withAgentTabReplace('old', 'p1', async () => null)).toBeNull();
    await expect(
      withAgentTabReplace('old', 'p1', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(await withAgentTabReplace('old', 'p1', async () => ({ id: 'old' }))).toEqual({ id: 'old' });
    expect(resumingAgents.size).toBe(0);
    expect(useApplicationTabs.getState().open.map(applicationTabId)).toEqual(['agent:old']);
  });
  it('does nothing to tabs when the old session had no tab', async () => {
    const { useApplicationTabs, withAgentTabReplace } = await load();
    useApplicationTabs.setState({ open: [], closed: [] });
    await withAgentTabReplace('old', 'p1', async () => ({ id: 'new' }));
    expect(useApplicationTabs.getState().open).toEqual([]);
  });
});

describe('store lifecycle and agent tabs', () => {
  const projects = [{ id: 'p1', name: 'P', path: '/tmp/p', createdAt: 1, lastActiveAt: 1 }];

  it('closeTerminal closes the nav tab without remembering it for reopen', async () => {
    const { useData, useApplicationTabs } = await load();
    useData.setState({ projects, terminals: { p1: [session('a'), session('b')] } });
    useApplicationTabs.setState({ open: [agentTab('a'), agentTab('b')], closed: [] });
    await useData.getState().closeTerminal('a', 'p1');
    expect(useApplicationTabs.getState().open).toEqual([agentTab('b')]);
    expect(useApplicationTabs.getState().closed).toEqual([]);
  });

  it('restartTerminal restore keeps the tab at its position under the new id', async () => {
    restore.mockResolvedValue({ ok: true, value: session('fresh', { restoreCapabilityId: 'c2' }) });
    const { useData, useApplicationTabs, applicationTabId, resumingAgents } = await load();
    useData.setState({
      projects,
      terminals: { p1: [session('dead', { status: 'exited', restoreCapabilityId: 'c1' })] }
    });
    useApplicationTabs.setState({ open: [agentTab('q'), agentTab('dead'), agentTab('z')], closed: [] });
    const created = await useData.getState().restartTerminal('dead', 'p1');
    expect(created?.id).toBe('fresh');
    expect(useApplicationTabs.getState().open.map(applicationTabId)).toEqual([
      'agent:q',
      'agent:fresh',
      'agent:z'
    ]);
    expect(resumingAgents.size).toBe(0);
  });

  it('restartTerminal failure leaves the tab and clears the in-flight mark', async () => {
    restore.mockResolvedValue({ ok: false, code: 'DENIED', message: 'nope' });
    const { useData, useApplicationTabs, resumingAgents } = await load();
    useData.setState({
      projects,
      terminals: { p1: [session('dead', { status: 'exited', restoreCapabilityId: 'c1' })] }
    });
    useApplicationTabs.setState({ open: [agentTab('dead')], closed: [] });
    expect(await useData.getState().restartTerminal('dead', 'p1')).toBeNull();
    expect(useApplicationTabs.getState().open).toEqual([agentTab('dead')]);
    expect(resumingAgents.size).toBe(0);
  });
});
