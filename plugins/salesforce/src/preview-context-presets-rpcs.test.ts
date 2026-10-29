import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '@zana-ai/zcc-db';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { createSalesforcePlugin } from '../lib/plugin.js';
import { createNodeDeps } from '../lib/node-deps.js';
const roots: string[] = [];
afterEach(() => { roots.forEach(root => rmSync(root, { recursive: true, force: true })); roots.length = 0; });
function temp() { const path = realpathSync(mkdtempSync(join(tmpdir(), 'context-presets-'))); roots.push(path); return path; }
describe('trusted preset RPC scopes and database persistence', () => {
  it('confines files, keys org identity by orgId, isolates projects and supports payloads beyond the KV limit', async () => {
    const root = temp(); const outside = temp();
    writeFileSync(join(root, 'A.agent'), 'variables:\n  locale: linked string');
    mkdirSync(join(root, 'sub')); writeFileSync(join(root, 'sub', 'A.agent'), 'variables:\n  locale: linked string');
    writeFileSync(join(outside, 'Secret.agent'), 'config:'); symlinkSync(join(outside, 'Secret.agent'), join(root, 'Escape.agent'));
    const db = createSqliteDatabase(':memory:');
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', database: { runScript: sql => { db.exec(sql); }, prepare: sql => db.prepare(sql), migrate: statements => statements.forEach(sql => db.exec(sql)), transaction: fn => db.transaction(fn)() }, listProjects: async () => [{ id: 'p', name: 'Project', path: root }, { id: 'q', name: 'Other registration', path: root }] });
    const deps = createNodeDeps();
    deps.execSf = vi.fn(async (args: string[]) => {
      if (args[0] === 'org' && args[1] === 'display') {
        const alias = args[args.indexOf('--target-org') + 1];
        return { code: 0, stderr: '', stdout: JSON.stringify({ status: 0, result: { id: alias === 'other' ? '00Dother' : '00Dsame', username: 'fixture@example.com', instanceUrl: 'https://example.invalid', accessToken: 'fixture', connectedStatus: 'Connected', isSandbox: true } }) };
      }
      return { code: 0, stderr: '', stdout: JSON.stringify({ status: 0, result: { nonScratchOrgs: [], scratchOrgs: [] } }) };
    });
    deps.request = vi.fn(async () => { throw Error('No org requests allowed'); });
    try {
      await createSalesforcePlugin(zcc, deps);
      expect(await harness.callRpc('studio.scenarios.list', {})).toMatchObject({ ok: false, error: expect.stringContaining('Choose a registered project') });
      const shared = await harness.callRpc('studio.scenarios.list', { projectId: 'p', path: 'A.agent' }) as any;
      expect(shared).toMatchObject({ ok: true }); expect(shared.scenarios).toHaveLength(3);
      expect(await harness.callRpc('studio.scenarios.list', { projectId: 'p', agentPath: 'A.agent' })).toMatchObject({ ok: true, scenarios: shared.scenarios });
      const list = (patch = {}) => harness.callRpc('agentPreview.presets.list', { projectId: 'p', path: 'A.agent', orgAlias: 'dev', ...patch }) as Promise<any>;
      const first = await list(); expect(first).toMatchObject({ ok: true, presets: [] });
      const input = { projectId: 'p', path: 'A.agent', orgAlias: 'dev', expectedScope: first.scopeKey,
        name: 'Large', values: [{ name: 'locale', type: 'Text', value: 'x'.repeat(60_000) }], fields: [{ name: 'locale', label: 'Locale', type: 'Text', declared: true }] };
      for (let i = 0; i < 5; i++) expect(await harness.callRpc('agentPreview.presets.save', { ...input, name: `Large ${i}` })).toMatchObject({ ok: true });
      expect((await list()).presets).toHaveLength(5);
      expect((await list({ orgAlias: 'renamed-dev' })).scopeKey).toBe(first.scopeKey);
      expect((await list({ orgAlias: 'renamed-dev' })).presets).toHaveLength(5);
      for (const patch of [{ orgAlias: 'other' }, { path: 'sub/A.agent' }, { path: undefined, apiName: 'A' }, { projectId: 'q' }]) {
        const isolated = await list(patch); expect(isolated.ok).toBe(true); expect(isolated.scopeKey).not.toBe(first.scopeKey); expect(isolated.presets).toEqual([]);
      }
      for (const patch of [{ path: '../Secret.agent' }, { path: 'Escape.agent' }, { path: undefined, apiName: '../A' }, { projectId: 'unregistered' }]) expect(await list(patch)).toMatchObject({ ok: false });
      expect(await harness.callRpc('agentPreview.presets.save', { ...input, orgAlias: 'other' })).toMatchObject({ ok: false, code: 'scope_changed' });
      expect(deps.request).not.toHaveBeenCalled();
      expect(deps.execSf.mock.calls.every(([args]) => args[0] === 'org')).toBe(true);
    } finally { await harness.dispose(); db.close(); }
  });
});
