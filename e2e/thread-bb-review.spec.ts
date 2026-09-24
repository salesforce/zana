import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect } from './fixtures/app.js';
import { createPluginStore, pluginStorePath } from '../apps/server/src/plugins/plugin-store.js';

const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const source = join(home, 'delayed-mention'); mkdirSync(source);
    writeFileSync(join(source, 'package.json'), JSON.stringify({
      name: '@zcc-ext/delayed-mention', version: '0.1.0', type: 'module',
      engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
      zcc: { name: 'Delayed mention', description: 'Thread admission fixture', server: './server.mjs' }
    }));
    writeFileSync(join(source, 'server.mjs'), `export default function(zcc) {
      let pending = [];
      let holdTools = false, pendingTools = [];
      zcc.agents.configure(() => holdTools ? new Promise(resolve => pendingTools.push(resolve)) : undefined);
      zcc.rpc.method('holdTools', () => { holdTools = true; return true; });
      zcc.rpc.method('pendingTools', () => pendingTools.length);
      zcc.rpc.method('releaseTools', () => { holdTools = false; const current = pendingTools; pendingTools = []; for (const resolve of current) resolve({}); return current.length; });
      zcc.ui.registerMentionProvider({ id: 'slow', label: 'Slow', search: () => [],
        resolve: () => new Promise(resolve => pending.push(resolve)) });
      zcc.rpc.method('pending', () => pending.length);
      zcc.rpc.method('release', () => { const current = pending; pending = []; for (const resolve of current) resolve({context:'Resolved fixture context'}); return current.length; });
    }`);
    await createPluginStore({ file: pluginStorePath(join(home, '.zcc')) }).upsert({
      id: 'delayed-mention', version: '0.1.0', name: 'Delayed mention', description: 'Thread admission fixture',
      icon: 'Puzzle', enabled: true, status: 'disabled', statusDetail: null,
      provenance: 'direct', sourceKind: 'path', source, rootDir: source,
      serverEntry: './server.mjs', appEntry: null, npmResolvedVersion: null, npmIntegrity: null,
      gitResolvedCommit: null, catalogMarketplace: null, catalogEntryId: null,
      installedAt: Date.now(), updatedAt: Date.now()
    });
    await use({ ZCC_FAKE_PROVIDER: '1' });
  }
});
test.use({ initialConfig: { tmuxScope: 'off', sponsorPromptDismissed: true } });

test('thread options survive public create, follow-up, stop and resume', async ({ app, home }) => {
  const win = app.window;
  const path = join(home, 'options-project'); mkdirSync(path);
  const id = await win.evaluate(async path => {
    const project = await window.cc.projects.add(path); if (!project.ok) throw new Error(project.message);
    const result = await (await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      projectId: project.value.id, providerId: 'fake', model: 'chosen-model', reasoningLevel: 'high', serviceTier: 'fast', input: 'report_execution_snapshot'
    }) })).json();
    if (!result.ok) throw new Error(result.message); return result.value.id;
  }, path);
  const timeline = () => win.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}/timeline`)).json()), id);
  await expect.poll(async () => (await timeline()).status).toBe('idle');
  await expect.poll(async () => JSON.stringify(await timeline())).toContain('Execution snapshot:');
  const settings = () => win.evaluate(async id => {
    const result = await (await fetch(`/api/v1/threads/${id}/events?limit=100`)).json();
    return result.events.filter((event: { type: string }) => event.type === 'client/turn/requested')
      .map((event: { payload: { execution: unknown } }) => event.payload.execution);
  }, id);
  await expect.poll(settings).toEqual([expect.objectContaining({ model: 'chosen-model', reasoningLevel: 'high', serviceTier: 'fast' })]);
  await win.evaluate(async id => { await fetch(`/api/v1/threads/${id}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); await fetch(`/api/v1/threads/${id}/resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); }, id);
  await win.evaluate(id => fetch(`/api/v1/threads/${id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'report_execution_snapshot resumed' }) }).then(response => response.json()), id);
  await expect.poll(settings).toHaveLength(2);
  expect((await settings())[1]).toMatchObject({ model: 'chosen-model', reasoningLevel: 'high', serviceTier: 'fast' });
  await expect.poll(async () => (await timeline()).status).toBe('idle');
  await win.evaluate(id => fetch(`/api/v1/threads/${id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'report_execution_snapshot changed', serviceTier: 'default', reasoningLevel: 'low' }) }).then(response => response.json()), id);
  await expect.poll(settings).toHaveLength(3);
  expect((await settings())[2]).toMatchObject({ model: 'chosen-model', reasoningLevel: 'low', serviceTier: 'default' });
  await expect.poll(async () => (await timeline()).status).toBe('idle');
  await win.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, id);
  await expect(win.getByTestId('thread-timeline')).toContainText('Execution snapshot:');
  await expect(win.getByTestId('thread-timeline')).toContainText('"reasoningLevel":"low"');
  await expect(win.getByTestId('thread-timeline')).toContainText('"serviceTier":"default"');
});

test('Stop and Archive cancel pending mention sends; a competing active turn queues them', async ({ app, home }) => {
  test.setTimeout(90_000);
  const win = app.window;
  const path = join(home, 'race-project'); mkdirSync(path);
  const projectId = await win.evaluate(async path => { const result = await window.cc.projects.add(path); if (!result.ok) throw new Error(result.message); return result.value.id; }, path);
  const request = (route: string, method = 'GET', body?: unknown) => win.evaluate(async ({ route, method, body }) => {
    const response = await fetch(`/api/v1/${route}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { route, method, body });
  const rpc = (method: string) => win.evaluate(method => window.cc.pluginApps.callRpc('delayed-mention', method, null), method);
  await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.list()).find(plugin => plugin.id === 'delayed-mention')?.status)).toBe('running');
  for (const action of ['stop', 'archive', 'competing-turn']) {
    const created = await request('threads', 'POST', { projectId, providerId: 'fake', input: 'initial response' });
    const id = created.body.thread.id as string;
    await expect.poll(async () => (await request(`threads/${id}`)).body.thread.status).toBe('idle');
    const pending = request(`threads/${id}/send`, 'POST', { mode: 'queue-if-active', input: [{ type: 'text', text: '@slow delayed message', mentions: [{
      start: 0, end: 5, resource: { kind: 'plugin', pluginId: 'delayed-mention', itemId: 'slow:item', label: 'slow' }
    }] }] });
    await expect.poll(() => rpc('pending')).toBe(1);
    if (action === 'competing-turn') {
      expect((await request(`threads/${id}/send`, 'POST', { input: 'delay:60000 competing response', mode: 'start' })).status).toBe(200);
    } else {
      expect((await request(`threads/${id}/${action}`, 'POST', {})).status).toBe(200);
    }
    await rpc('release');
    if (action === 'competing-turn') {
      expect((await pending).status).toBe(200);
      await expect.poll(async () => (await request(`threads/${id}/next-turn`)).body.items.map((item: { text: string }) => item.text)).toEqual(['@slow delayed message']);
      await request(`threads/${id}/stop`, 'POST', {});
      expect((await request(`threads/${id}/next-turn`)).body.paused).toBe(true);
    } else {
      expect(await pending).toMatchObject({ status: 409, body: { code: 'send_cancelled' } });
      expect(JSON.stringify((await request(`threads/${id}/events?limit=100`)).body)).not.toContain('delayed message');
      if (action === 'archive') expect((await request(`threads/${id}/resume`, 'POST', {})).status).toBe(409);
      else expect((await request(`threads/${id}/next-turn`)).body.items).toEqual([]);
    }
  }
});


test('Stop during initial session preparation prevents the first turn from launching', async ({ app, home }) => {
  const win = app.window;
  const path = join(home, 'creation-race-project'); mkdirSync(path);
  const projectId = await win.evaluate(async path => {
    const result = await window.cc.projects.add(path); if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, path);
  const rpc = (method: string) => win.evaluate(method => window.cc.pluginApps.callRpc('delayed-mention', method, null), method);
  await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.list()).find(plugin => plugin.id === 'delayed-mention')?.status)).toBe('running');
  await rpc('holdTools');
  const id = randomUUID();
  const creating = win.evaluate(async ({ id, projectId }) => {
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, projectId, providerId: 'fake', input: 'work must not start' }) });
    return { status: response.status, body: await response.json() };
  }, { id, projectId });
  await expect.poll(() => rpc('pendingTools')).toBe(1);
  await win.evaluate(id => fetch(`/api/v1/threads/${id}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(response => response.json()), id);
  await rpc('releaseTools');
  expect(await creating).toMatchObject({ status: 409, body: { code: 'send_cancelled' } });
  const snapshot = await win.evaluate(async id => ({
    thread: (await (await fetch(`/api/v1/threads/${id}`)).json()).thread,
    events: (await (await fetch(`/api/v1/threads/${id}/events?limit=100`)).json()).events
  }), id);
  expect(snapshot.thread.status).toBe('idle');
  expect(snapshot.events.some((event: { type: string }) => event.type === 'client/turn/requested')).toBe(false);
});
