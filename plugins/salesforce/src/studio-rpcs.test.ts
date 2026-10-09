import { describe, expect, it, vi } from 'vitest';
import type { SalesforceDeps } from '../lib/types.js';
import { STUDIO_RPC } from '../lib/studio-contract.js';
import { notImplemented, registerStubRpcs, rpcFailure, rpcString } from '../lib/studio-server-context.js';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { createSalesforcePlugin } from '../lib/plugin.js';
import { createNodeDeps } from '../lib/node-deps.js';
import { WORKBENCH_ACTIONS } from '../lib/workbench-actions.js';

function collect(register: (studio: any) => void) {
  const names = new Map<string, (args: unknown) => any>();
  register({ registerRpc: (name: string, handler: (args: unknown) => any) => names.set(name, handler) });
  return names;
}

describe('studio server seams', () => {
  it('follows the {ok:false, code, error} failure convention', () => {
    expect(rpcFailure('x', 'y')).toEqual({ ok: false, code: 'x', error: 'y' });
    expect(notImplemented('studio.explorer')).toMatchObject({ ok: false, code: 'not_implemented' });
    expect(rpcString({ a: ' v ' }, 'a')).toBe('v');
    expect(rpcString({ a: 1 }, 'a')).toBe('');
    expect(rpcString(null, 'a')).toBe('');
    const names = collect(studio => registerStubRpcs(studio, ['a', 'b']));
    expect([...names.keys()]).toEqual(['a', 'b']);
  });
  it('registers every studio RPC with a real (non-stub) handler', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sf-studio-rpcs-')));
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p', name: 'Project', path: root }] });
    try {
      const deps = createNodeDeps();
      deps.execSf = vi.fn<SalesforceDeps['execSf']>(async () => ({ code: 1, stderr: 'no org', stdout: '' }));
      deps.request = vi.fn<SalesforceDeps['request']>(async () => ({ status: 404, json: {}, text: '' }));
      await createSalesforcePlugin(zcc, deps);
      for (const name of Object.values(STUDIO_RPC)) {
        const result = await harness.callRpc(name, { projectId: 'p' }).catch((error: Error) => {
          expect(error.message).not.toMatch(/unknown rpc/);
          return null;
        });
        expect(result ?? {}).not.toMatchObject({ code: 'not_implemented' });
      }
    } finally {
      await harness.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
  it('maps the new workbench actions onto registered studio RPCs', () => {
    expect(WORKBENCH_ACTIONS['view.state']).toEqual([STUDIO_RPC.viewGet, 'local', expect.any(String)]);
    expect(WORKBENCH_ACTIONS['comments.list'][0]).toBe(STUDIO_RPC.comments);
    expect(WORKBENCH_ACTIONS['comments.add'][0]).toBe(STUDIO_RPC.commentAdd);
    expect(WORKBENCH_ACTIONS['comments.resolve'][0]).toBe(STUDIO_RPC.commentResolve);
    expect(WORKBENCH_ACTIONS['suites.list'][0]).toBe(STUDIO_RPC.suites);
    expect(WORKBENCH_ACTIONS['preview.trace']).toEqual([STUDIO_RPC.trace, 'org', expect.any(String)]);
  });
});
