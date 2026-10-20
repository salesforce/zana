import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { HUB_PROJECT_LIMIT, HUB_SCAN_LIMIT, listHubProjects } from '../lib/hub-projects.js';
import { createSalesforcePlugin } from '../lib/plugin.js';
import type { SalesforceDeps } from '../lib/types.js';

const fs = (dx: string[], missing: string[] = []) => ({
  realpath: (path: string) => { if (missing.includes(path)) throw Error('ENOENT'); return path; },
  exists: (path: string) => dx.some(root => path === `${root}/sfdx-project.json`),
});
const kv = (values: Record<string, unknown> = {}) => ({ get: async <T,>(key: string) => values[key] as T | undefined });

describe('listHubProjects', () => {
  it('lists local projects, Salesforce ones first, with their target and no paths', async () => {
    const rows = await listHubProjects([
      { id: 'notes', name: 'Notes', path: '/notes', local: true },
      { id: 'dx', name: 'Zeta DX', path: '/dx' },
      { id: 'icon', name: 'Agents', path: '/icon', icon: 'Cloud' },
      { id: 'target', name: 'Beta', path: '/target' },
      { id: 'remote', name: 'Remote', path: '/remote', local: false },
      { id: 'nopath', name: 'No path' },
      { id: 'quick', name: 'Default', path: '/quick', quickAgent: true },
      { id: 'gone', name: 'Gone', path: '/gone' },
    ], kv({ 'sf:project:target:org': ' dev ', 'sf:project:notes:org': '  ' }), fs(['/dx'], ['/gone']));
    expect(rows).toEqual([
      { id: 'icon', name: 'Agents', salesforce: true, dxProject: false, targetAlias: null },
      { id: 'target', name: 'Beta', salesforce: true, dxProject: false, targetAlias: 'dev' },
      { id: 'dx', name: 'Zeta DX', salesforce: true, dxProject: true, targetAlias: null },
      { id: 'notes', name: 'Notes', salesforce: false, dxProject: false, targetAlias: null },
    ]);
  });

  it('caps the menu', async () => {
    const many = Array.from({ length: HUB_PROJECT_LIMIT + 5 }, (_, i) => ({ id: `p${i}`, name: `P${String(i).padStart(3, '0')}`, path: `/p${i}` }));
    expect(await listHubProjects(many, kv(), fs([]))).toHaveLength(HUB_PROJECT_LIMIT);
  });

  it('reads targets one at a time and tolerates a failed read', async () => {
    let inFlight = 0;
    const busyKv = {
      get: async <T,>(key: string) => {
        if (inFlight > 0) throw Error('Storage is busy');
        inFlight++;
        await new Promise(resolve => setTimeout(resolve, 1));
        inFlight--;
        if (key === 'sf:project:p1:org') throw Error('Storage is busy');
        return (key === 'sf:project:p2:org' ? 'dev' : undefined) as T | undefined;
      },
    };
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `P${String(i).padStart(2, '0')}`, path: `/p${i}` }));
    const rows = await listHubProjects(many, busyKv, fs([]));
    expect(rows).toHaveLength(40);
    expect(rows[0]).toMatchObject({ id: 'p2', targetAlias: 'dev' });
    expect(rows.find(row => row.id === 'p1')).toMatchObject({ targetAlias: null });
  });

  it('scans a bounded number of registered projects', async () => {
    const many = Array.from({ length: HUB_SCAN_LIMIT + 10 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, path: `/p${i}` }));
    const seen: string[] = [];
    await listHubProjects(many, { get: async <T,>(key: string) => { seen.push(key); return undefined as T | undefined; } }, fs([]));
    expect(seen).toHaveLength(HUB_SCAN_LIMIT);
  });

  it('answers the hub.projects RPC from registered projects', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    const deps = { ...fs(['/proj']), execSf: async () => ({ code: 1, stdout: '', stderr: '' }) } as unknown as SalesforceDeps;
    await createSalesforcePlugin(zcc, deps);
    await expect(harness.callRpc('hub.projects')).resolves.toEqual({
      ok: true, projects: [{ id: 'p1', name: 'DX', salesforce: true, dxProject: true, targetAlias: null }],
    });
  });
});
