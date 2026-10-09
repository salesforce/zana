import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { createPrMonitorPlugin } from '../lib/plugin.js';
import { PANEL_UI_CHANNEL, PRS_CHANGED_CHANNEL, parsePanelUiAction } from '../lib/realtime.js';
import { PANEL_AGENT_INSTRUCTIONS, READ_TOOL_NAMES, TOOL_NAMES, parsePrUrl, resolvePr } from '../lib/tools.js';
import type { MonitoredPr } from '../lib/types.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function pr(overrides: Partial<MonitoredPr> & Pick<MonitoredPr, 'repo' | 'number'>): MonitoredPr {
  const now = 1_700_000_000_000;
  return {
    url: `https://github.com/${overrides.repo}/pull/${overrides.number}`,
    title: `PR ${overrides.number}`,
    baseRefName: 'main',
    headRefName: `topic-${overrides.number}`,
    status: 'green',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    checks: [],
    addedAt: now,
    lastChecked: now,
    lastStatusChange: now,
    lastSeenAt: now,
    source: 'manual',
    body: 'Body',
    ...overrides
  };
}

const failing = pr({
  repo: 'acme/app', number: 42, title: 'Fix flaky checkout test', status: 'failed', lastSeenAt: 0,
  checks: [{ name: 'Integration tests', state: 'FAILURE' }, { name: 'Lint', state: 'SUCCESS' }, { name: 'Build', state: 'x', bucket: 'fail' }]
});
const green = pr({ repo: 'acme/api', number: 7, title: 'Add health endpoint', body: 'y'.repeat(5_000) });
const twin = pr({ repo: 'acme/web', number: 7, title: 'Tweak header' });

async function setup(options: { pollAll?: () => Promise<{ ok: boolean; prs?: MonitoredPr[]; deltas?: never[]; error?: string }>; syncWaitMs?: number } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'zcc-prm-tools-'));
  dirs.push(dataDir);
  const { zcc, harness } = createFakePluginHost({ pluginId: 'pr-monitor', listProjects: async () => [] });
  await zcc.storage.kv.set('prs', { [failing.url]: failing, [green.url]: green, [twin.url]: twin });
  await createPrMonitorPlugin(zcc, {
    exec: async () => ({ code: 1, stdout: '', stderr: 'offline' }),
    startBackground: false,
    dataDir,
    ...options
  });
  const call = (name: string, input: unknown) => harness.callAgentTool(name, input) as Promise<Record<string, any>>;
  const configure = async (ctx: unknown) => {
    expect(harness.agentConfigurers).toHaveLength(1);
    return (await harness.agentConfigurers[0](ctx as never)) ?? {};
  };
  return { harness, call, configure };
}

describe('resolvePr / parsePrUrl', () => {
  const prs = [failing, green, twin];
  it('resolves URLs, owner/repo#n and unique bare numbers', () => {
    expect(resolvePr(prs, failing.url.toUpperCase())).toBe(failing);
    expect(resolvePr(prs, 'acme/app#42')).toBe(failing);
    expect(resolvePr(prs, '#42')).toBe(failing);
    expect(resolvePr(prs, 42)).toBe(failing);
  });
  it('explains ambiguous, unknown and empty references', () => {
    expect(resolvePr(prs, '7')).toEqual({ error: expect.stringContaining('acme/api#7, acme/web#7') });
    expect(resolvePr(prs, 'acme/app#9')).toEqual({ error: expect.stringContaining('No tracked PR') });
    expect(resolvePr(prs, 'not a pr')).toEqual({ error: expect.stringContaining('No tracked PR') });
    expect(resolvePr(prs, undefined)).toEqual({ error: expect.stringContaining('Pass a PR URL') });
  });
  it('parses only https pull URLs', () => {
    expect(parsePrUrl('https://ghe.example.com/a/b/pull/3/')).toEqual({ host: 'ghe.example.com', fullName: 'a/b', number: 3 });
    expect(parsePrUrl('http://github.com/a/b/pull/3')).toBeNull();
    expect(parsePrUrl('https://github.com/a/b/issues/3')).toBeNull();
    expect(parsePrUrl('nope')).toBeNull();
  });
});

describe('parsePanelUiAction', () => {
  it('accepts filter and reveal payloads and drops everything else', () => {
    expect(parsePanelUiAction({ action: 'filter', repos: ['a/b', 3], query: 'x' })).toEqual({ action: 'filter', repos: ['a/b'], query: 'x' });
    expect(parsePanelUiAction({ action: 'filter' })).toEqual({ action: 'filter', repos: [], query: '' });
    expect(parsePanelUiAction({ action: 'reveal', url: 'u' })).toEqual({ action: 'reveal', url: 'u' });
    expect(parsePanelUiAction({ action: 'reveal' })).toBeNull();
    expect(parsePanelUiAction({ action: 'delete' })).toBeNull();
    expect(parsePanelUiAction(null)).toBeNull();
  });
});

describe('PR Monitor agent configuration', () => {
  const base = {
    thread: { id: 't1', title: null, parentThreadId: null, sourceThreadId: null },
    project: { id: 'p1', kind: 'standard' as const, name: 'P', gitRemoteUrl: null },
    environment: { id: 'e1', name: null, path: null, workspaceProvisionType: 'unmanaged' as const, branchName: null },
    host: { id: 'h1', name: 'laptop' },
    provider: { id: 'fake', model: 'm', capabilities: { supportsNativeUserQuestion: false } }
  };

  it('gives its panel Agent tab every tool plus board context', async () => {
    const { harness, configure } = await setup();
    const resolved = await configure({
      ...base, origin: { kind: null, pluginId: 'pr-monitor' }, pluginMetadata: { panelAgent: { panel: 'main' } }
    });
    expect(resolved).toEqual({ tools: [...TOOL_NAMES], instructions: PANEL_AGENT_INSTRUCTIONS });
    expect(harness.agentTools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(harness.agentTools.find((tool) => tool.name === 'pr_monitor_panel')?.desktopOnly).toBe(true);
  });

  it('gives other conversations read-only board tools', async () => {
    const { configure } = await setup();
    for (const ctx of [
      {},
      { ...base, origin: { kind: null, pluginId: null } },
      { ...base, origin: { kind: null, pluginId: 'pr-monitor' }, pluginMetadata: {} },
      { ...base, origin: { kind: null, pluginId: 'pr-monitor' }, pluginMetadata: { panelAgent: ['x'] } }
    ]) {
      expect(await configure(ctx)).toEqual({ tools: [...READ_TOOL_NAMES] });
    }
  });
});

describe('PR Monitor agent tools', () => {
  it('lists the board with filters and limits', async () => {
    const { call } = await setup();
    const all = await call('pr_monitor_list', {});
    expect(all.total).toBe(3);
    expect(all.prs[0]).toMatchObject({
      ref: 'acme/app#42', status: 'failed', unread: true, failingChecks: ['Integration tests', 'Build'], branch: 'topic-42 → main'
    });
    expect((await call('pr_monitor_list', { status: ['failed'] })).prs.map((row: { ref: string }) => row.ref)).toEqual(['acme/app#42']);
    expect((await call('pr_monitor_list', { repo: 'ACME/api' })).total).toBe(1);
    expect((await call('pr_monitor_list', { query: 'header' })).prs[0].ref).toBe('acme/web#7');
    expect((await call('pr_monitor_list', { unreadOnly: true })).total).toBe(1);
    expect(await call('pr_monitor_list', { limit: 1 })).toMatchObject({ total: 3, truncated: true });
  });

  it('shows one PR in full with a bounded body', async () => {
    const { call } = await setup();
    const shown = await call('pr_monitor_show', { pr: 'acme/api#7' });
    expect(shown.pr).toMatchObject({ ref: 'acme/api#7', mergeStateStatus: 'CLEAN' });
    expect(shown.pr.body).toHaveLength(4_001);
    expect(await call('pr_monitor_show', { pr: '7' })).toMatchObject({ ok: false, error: expect.stringContaining('matches') });
  });

  it('updates read, mute, favorite and project and refreshes the board', async () => {
    const { call, harness } = await setup();
    const updated = await call('pr_monitor_update', { pr: '#42', read: true, muted: true, favorite: true, projectId: 'p1' });
    expect(updated).toMatchObject({ ok: true, pr: { ref: 'acme/app#42', unread: false, muted: true, favorite: true, projectId: 'p1' } });
    const cleared = await call('pr_monitor_update', { pr: '#42', read: false, muted: false, favorite: false, projectId: null });
    expect(cleared.pr).toMatchObject({ unread: true });
    expect(cleared.pr).not.toHaveProperty('projectId');
    expect(cleared.pr).not.toHaveProperty('favorite');
    const signals = harness.published.filter((signal) => signal.event === PRS_CHANGED_CHANNEL);
    expect(signals).toHaveLength(2);
    expect(signals[1].payload).toMatchObject({ deltas: [], inAppDeltas: [], prs: expect.any(Array) });
    expect(await call('pr_monitor_update', { pr: '#42' })).toMatchObject({ ok: false, error: expect.stringContaining('at least one') });
  });

  it('removes a PR and reports the remaining count', async () => {
    const { call } = await setup();
    expect(await call('pr_monitor_remove', { pr: 'acme/web#7' })).toEqual({ ok: true, tracked: 2 });
    expect(await call('pr_monitor_remove', { pr: 'acme/web#7' })).toMatchObject({ ok: false });
  });

  it('adds by URL only for connected repos', async () => {
    const { call, harness } = await setup();
    expect(await call('pr_monitor_add', { url: 'acme/app#1' })).toMatchObject({ ok: false, error: expect.stringContaining('pull request URL') });
    expect(await call('pr_monitor_add', { url: 'https://github.com/acme/app/pull/1' }))
      .toMatchObject({ ok: false, error: 'That repository is not connected and active.' });
    expect(harness.published.some((signal) => signal.event === PRS_CHANGED_CHANNEL)).toBe(false);
  });

  it('retries one PR and refreshes the board', async () => {
    const { call, harness } = await setup();
    expect(await call('pr_monitor_retry', { pr: '#42' })).toMatchObject({ ok: true, pr: { ref: 'acme/app#42' } });
    expect(harness.published.filter((signal) => signal.event === PRS_CHANGED_CHANNEL)).toHaveLength(1);
    expect(await call('pr_monitor_retry', { pr: '#404' })).toMatchObject({ ok: false });
  });

  it('syncs and returns status changes', async () => {
    const delta = { pr: { ...failing, status: 'green' }, oldStatus: 'failed', newStatus: 'green' };
    const pollAll = vi.fn(async () => ({ ok: true, prs: [failing], deltas: [delta] as never[] }));
    const { call } = await setup({ pollAll });
    expect(await call('pr_monitor_sync', {})).toEqual({
      ok: true, state: 'succeeded', tracked: 1, changes: [{ ref: 'acme/app#42', from: 'failed', to: 'green' }]
    });
    expect(pollAll).toHaveBeenCalledOnce();
  });

  it('surfaces a failed sync and one that outlives the wait', async () => {
    const failed = await setup({ pollAll: async () => ({ ok: false, error: 'gh is not authenticated' }) });
    expect(await failed.call('pr_monitor_sync', {})).toEqual({ ok: false, error: 'gh is not authenticated' });
    const slow = await setup({ pollAll: () => new Promise(() => undefined), syncWaitMs: 0 });
    expect(await slow.call('pr_monitor_sync', {})).toMatchObject({ ok: true, state: 'running', note: expect.any(String) });
  });

  it('scopes a sync to repos', async () => {
    const { call } = await setup({ syncWaitMs: 0 });
    expect(await call('pr_monitor_sync', { repos: ['acme/app', ''] })).toMatchObject({ ok: true });
  });

  it('sends filter and reveal requests to the open panel', async () => {
    const { call, harness } = await setup();
    expect(await call('pr_monitor_panel', { action: 'filter', repos: ['acme/app'], query: ' flaky ' }))
      .toMatchObject({ ok: true, sent: { action: 'filter', repos: ['acme/app'], query: 'flaky' } });
    expect(await call('pr_monitor_panel', { action: 'reveal', pr: '#42' }))
      .toMatchObject({ ok: true, sent: { action: 'reveal', ref: 'acme/app#42' } });
    expect(await call('pr_monitor_panel', { action: 'reveal', pr: '#99' })).toMatchObject({ ok: false });
    expect(harness.published.filter((signal) => signal.event === PANEL_UI_CHANNEL).map((signal) => signal.payload)).toEqual([
      { action: 'filter', repos: ['acme/app'], query: 'flaky' },
      { action: 'reveal', url: failing.url }
    ]);
  });
});
