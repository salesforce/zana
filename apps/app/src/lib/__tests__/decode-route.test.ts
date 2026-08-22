import { describe, expect, it } from 'vitest';
import { decodeRoutePath, scopedProjectIdFromSearch, scopedWindowLockReplace } from '../decode-route.js';

describe('decodeRoutePath', () => {
  it.each([
    ['/', { nav: 'home', focusedProjectId: null }],
    ['/inbox', { nav: 'inbox' }],
    ['/agents', { nav: 'agents' }],
    ['/followups', { nav: 'followups' }],
    ['/suggestions', { nav: 'suggestions' }],
    ['/scheduler', { nav: 'scheduler' }],
    ['/goals', { nav: 'goals' }],
    ['/settings', { nav: 'settings', settingsTab: 'global' }],
    ['/settings/terminal', { nav: 'settings', settingsTab: 'terminal' }],
    ['/settings/project', { nav: 'settings', settingsTab: 'project' }],
    ['/extensions', { nav: 'extensions', extensionsTab: 'installed' }],
    ['/extensions/plugins', { nav: 'extensions', extensionsTab: 'installed' }],
    ['/extensions/plugins/browse', { nav: 'extensions', extensionsTab: 'marketplace' }],
    ['/extensions/plugins/slack', { nav: 'extensions', extensionsTab: 'installed', settingsExtensionId: 'slack' }],
    ['/extensions/skills', { nav: 'extensions', extensionsTab: 'skills' }],
    ['/extensions/mcp', { nav: 'extensions', extensionsTab: 'mcp' }],
    ['/projects/p1', { nav: 'projects', focusedProjectId: 'p1', workspaceMode: 'agents', isProjectWorkspace: true }],
    ['/projects/p1/terminals', { nav: 'projects', focusedProjectId: 'p1', workspaceMode: 'terminals', isProjectWorkspace: true }],
    ['/projects/p1/settings', { nav: 'settings', settingsTab: 'project', focusedProjectId: 'p1', isProjectSettings: true }],
    ['/plugins/docs/panel', { nav: 'docs' }],
    ['/plugins/docs/panel/sub', { nav: 'docs' }]
  ] as const)('decodes %s', (path, expected) => {
    expect(decodeRoutePath(path)).toEqual(expect.objectContaining(expected));
  });

  it('reads a settings hash as the subsection anchor', () => {
    expect(decodeRoutePath('/settings/global', '#appearance').settingsAnchor).toBe('appearance');
  });

  it('strips empty hashes and falls back when decodeURIComponent fails', () => {
    expect(decodeRoutePath('/settings', '').settingsAnchor).toBeNull();
    expect(decodeRoutePath('/settings', '#').settingsAnchor).toBeNull();
    expect(decodeRoutePath('/settings', '#%').settingsAnchor).toBe('%');
    expect(decodeRoutePath('/settings', '#%E0%A4').settingsAnchor).toBe('%E0%A4');
  });

  it('decodes malformed path params without throwing', () => {
    expect(decodeRoutePath('/settings/%E0%A4').settingsTab).toBe('%E0%A4');
    expect(decodeRoutePath('/projects/%E0%A4').focusedProjectId).toBe('%E0%A4');
  });

  it('treats unknown paths as home and keeps a hash anchor', () => {
    expect(decodeRoutePath('/not-a-route', '#x')).toEqual(
      expect.objectContaining({ nav: 'home', settingsAnchor: 'x' })
    );
  });

  it('lets /extensions/plugins/browse win over :pluginId', () => {
    expect(decodeRoutePath('/extensions/plugins/browse').extensionsTab).toBe('marketplace');
    expect(decodeRoutePath('/extensions/plugins/browse').settingsExtensionId).toBeNull();
  });

  it('lets /projects/:id/settings win over :mode', () => {
    const decoded = decodeRoutePath('/projects/p1/settings');
    expect(decoded.isProjectSettings).toBe(true);
    expect(decoded.workspaceMode).toBeNull();
  });

  it('reads scoped project ids from the query alias', () => {
    expect(scopedProjectIdFromSearch('?projectId=abc')).toBe('abc');
    expect(scopedProjectIdFromSearch('projectId=abc')).toBe('abc');
    expect(scopedProjectIdFromSearch('surface=popover')).toBeNull();
    expect(scopedProjectIdFromSearch('?projectId=')).toBeNull();
    expect(scopedProjectIdFromSearch('?projectId=%20')).toBeNull();
  });

  it('replaces a locked window that leaves /projects/:id back onto the project', () => {
    expect(
      scopedWindowLockReplace({ pathname: '/inbox', search: '', hash: '' }, 'p1')
    ).toEqual({ pathname: '/projects/p1', search: '?projectId=p1', hash: '' });
    expect(
      scopedWindowLockReplace(
        { pathname: '/inbox', search: '?surface=x', hash: '#h' },
        'p1'
      )
    ).toEqual({ pathname: '/projects/p1', search: '?surface=x&projectId=p1', hash: '#h' });
    expect(
      scopedWindowLockReplace({ pathname: '/projects/p1', search: '?projectId=p1', hash: '' }, 'p1')
    ).toBeNull();
    expect(
      scopedWindowLockReplace({ pathname: '/projects/p1/terminals', search: '', hash: '' }, 'p1')
    ).toBeNull();
    expect(
      scopedWindowLockReplace({ pathname: '/projects/other', search: '', hash: '' }, 'p1')
    ).toEqual({ pathname: '/projects/p1', search: '?projectId=p1', hash: '' });
  });
});
