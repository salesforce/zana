import { describe, expect, it } from 'vitest';
import { STUDIO_RPC } from '../lib/studio-contract.js';
import { notImplemented, registerStubRpcs, rpcFailure, rpcString } from '../lib/studio-server-context.js';
import { registerStudioAssistant } from '../lib/studio-threads.js';
import { registerStudioContext } from '../lib/studio-view.js';
import { registerStudioComments } from '../lib/studio-comments.js';
import { registerStudioPreview } from '../lib/scenario-suites.js';
import { registerStudioExplorer } from '../lib/studio-explorer.js';
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
  it.each([
    ['assistant', registerStudioAssistant, [STUDIO_RPC.askAgent, STUDIO_RPC.threads, STUDIO_RPC.unlink]],
    ['context', registerStudioContext, [STUDIO_RPC.viewPublish, STUDIO_RPC.viewGet]],
    ['comments', registerStudioComments, [STUDIO_RPC.comments, STUDIO_RPC.commentAdd, STUDIO_RPC.commentResolve]],
    ['preview', registerStudioPreview, [STUDIO_RPC.trace, STUDIO_RPC.suites, STUDIO_RPC.suiteSave, STUDIO_RPC.suiteRun]],
    ['explorer', registerStudioExplorer, [STUDIO_RPC.explorer]],
  ] as const)('%s stub registers its RPCs as not_implemented', (_name, register, expected) => {
    const names = collect(register);
    expect([...names.keys()]).toEqual(expected);
    for (const handler of names.values()) expect(handler({})).toMatchObject({ ok: false, code: 'not_implemented' });
  });
  it('maps the new workbench actions onto registered studio RPCs', () => {
    expect(WORKBENCH_ACTIONS['view.state']).toEqual([STUDIO_RPC.viewGet, 'local', expect.any(String)]);
    expect(WORKBENCH_ACTIONS['comments.list'][0]).toBe(STUDIO_RPC.comments);
    expect(WORKBENCH_ACTIONS['comments.add'][0]).toBe(STUDIO_RPC.commentAdd);
    expect(WORKBENCH_ACTIONS['comments.resolve'][0]).toBe(STUDIO_RPC.commentResolve);
    expect(WORKBENCH_ACTIONS['suites.list'][0]).toBe(STUDIO_RPC.suites);
    expect(WORKBENCH_ACTIONS['preview.trace']).toEqual([STUDIO_RPC.trace, 'org', expect.any(String)]);
  });
});
