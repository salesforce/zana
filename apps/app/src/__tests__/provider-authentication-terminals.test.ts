// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
const state = vi.hoisted(() => ({ updated: undefined as ((session: TerminalSession) => void) | undefined }));
vi.mock('../lib/app-surface.js', () => ({ hasDesktopBridge: () => false }));
vi.mock('../lib/product-client.js', () => ({ product: new Proxy({}, { get: (_target, group) => new Proxy({}, {
  get: (_target, method) => {
    if (method === 'groups') return { list: async () => [], onChanged: () => () => {} };
    if (group === 'config' && method === 'get') return async () => ({ walkthroughCompleted: true, setupDismissed: true });
    if (group === 'terminals' && method === 'onUpdated') return (updated: (session: TerminalSession) => void) => { state.updated = updated; return () => {}; };
    if (String(method).startsWith('on')) return () => () => {};
    if (method === 'history') return async () => ({ entries: [] });
    if (method === 'getReadState') return async () => ({ readIds: {}, migratedFromLocalStorage: true });
    if (method === 'consumeWhatsNew') return async () => null;
    return async () => [];
  }
}) }) }));
import { useData } from '../store.js';
afterEach(() => { useData.setState({ terminals: {} }); vi.restoreAllMocks(); });
it('keeps temporary sign-in terminals in Settings while ordinary project terminals still update', async () => {
  await useData.getState().init();
  const signIn: TerminalSession = { id: 'login', projectId: 'provider-sign-in:machine', hostId: 'machine', profile: 'shell', cwd: '/fixture', status: 'running', createdAt: 1, providerSignIn: { providerId: 'fixture' } };
  state.updated!(signIn);
  expect(useData.getState().terminals[signIn.projectId]).toBeUndefined();
  const { providerSignIn: _owned, ...terminal } = { ...signIn, id: 'normal', projectId: 'project' };
  state.updated!(terminal);
  expect(useData.getState().terminals.project).toEqual([terminal]);
});
