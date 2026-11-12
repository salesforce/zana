import { beforeEach, describe, expect, it } from 'vitest';
import { setupPath, useSetupPages, type SetupRequest } from './setup-pages.js';
import type { MachineProjectGroup } from '../../lib/machine-projects.js';
import { useApplicationTabs } from '../../lib/application-tabs.js';
const group = {
  id: 'a',
  name: 'This Mac',
  primary: true,
  projects: []
} as MachineProjectGroup;
beforeEach(() => {
  useSetupPages.setState({ pages: [] });
  useApplicationTabs.setState({ open: [], closed: [], initializedScope: undefined });
});
describe('window-local setup drafts', () => {
  it('deduplicates machine and action drafts, snapshots the target, and preserves the original return route', () => {
    const request: SetupRequest = { kind: 'project', group, mode: 'clone' };
    const s = useSetupPages.getState();
    const id = s.open(request, '/threads/t?draft=1');
    expect(s.open(request, '/')).toBe(id);
    expect(useSetupPages.getState().pages).toEqual([
      expect.objectContaining({
        request,
        returnPath: '/threads/t?draft=1',
        title: 'Clone from Git · This Mac'
      })
    ]);
    expect(setupPath(id!)).toBe('/setup/project%3Aa%3Aclone');
    expect(
      s.open(
        { kind: 'project', group: { ...group, id: 'b' }, mode: 'open' },
        '/setup/old'
      )
    ).not.toBe(id);
    expect(useSetupPages.getState().pages[1].returnPath).toBe('/');
  });
  it('never closes a running operation or evicts drafts at the cap', () => {
    const s = useSetupPages.getState();
    const id = s.open({ kind: 'machine' }, '/settings/machines')!;
    s.setBusy(id, true);
    expect(s.close(id)).toBe(false);
    s.setBusy(id, true);
    s.setBusy('missing', false);
    for (let n = 0; n < 11; n++)
      s.open(
        { kind: 'project', group: { ...group, id: String(n) }, mode: 'create' },
        '/'
      );
    expect(s.open({ kind: 'project', group, mode: 'open' }, '/')).toBeNull();
    expect(useSetupPages.getState().pages).toHaveLength(12);
    s.setBusy(id, false);
    expect(s.close(id)).toBe(true);
    expect(useSetupPages.getState().pages).toHaveLength(11);
  });
  it('keys plugin pages by machine and generation, and names the connection page', () => {
    const state = {
      title: 'CRM project',
      params: null,
      action: { pluginId: 'crm', id: 'new', generation: 1 }
    } as Extract<SetupRequest, { kind: 'plugin' }>['state'];
    const s = useSetupPages.getState();
    s.open({ kind: 'plugin', group, state }, '/');
    s.open(
      {
        kind: 'plugin',
        group,
        state: { ...state, action: { ...state.action, generation: 2 } }
      },
      '/'
    );
    s.open({ kind: 'machine' }, '/');
    expect(useSetupPages.getState().pages.map((x) => x.title)).toEqual([
      'CRM project · This Mac',
      'CRM project · This Mac',
      'Connect a machine'
    ]);
  });
});
