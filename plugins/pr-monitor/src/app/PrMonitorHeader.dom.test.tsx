/**
 * @vitest-environment happy-dom
 *
 * Panel-header DOM tests — the "PR Monitor" header and its list-requirements
 * ACs that live above PrTileList:
 *  - title + one-line subtitle                       AC-LIST-1.1/1.2
 *  - split Sync control: primary sync, in-flight,    AC-LIST-2.1/2.7/2.9
 *    dropdown opens the Sync & Filter picker
 *  - Sync & Filter picker: All + per-repo, filter,   AC-LIST-2.2…2.6/2.8
 *    scoped/all sync, Close
 *  - Pull PR dialog: repo selector + number, hover,  AC-LIST-3.1/3.2/3.3/3.7
 *  - Sweep: present only with terminal PRs, targets  AC-LIST-4.1/4.2/4.3/4.5
 *    exactly Merged/Closed, hover text
 *
 * Mounts the real PrMonitorPanel with a stateful in-memory host, mirroring the
 * harness in PrMonitorPanel.dom.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ModuleHost, ProjectInfo } from './host.js';
import PrMonitorPanel from './PrMonitorPanel.js';
import {
  type MonitoredPr,
  type PrMonitorSettings,
  type PrRollupStatus,
  MONITORED_PRS_CACHE_KEY,
  SETTINGS_STORAGE_KEY,
} from '../../lib/types.js';

const PROJECTS: ProjectInfo[] = [{ id: 'proj-a', name: 'Alpha', path: '/repos/alpha' }];

const SETTINGS: PrMonitorSettings = {
  pollIntervalMinutes: 15,
  notifyOnChange: false,
  badgeMode: 'unread',
  watchedRepos: [],
  watchedPeople: [],
  relevanceModes: { authored: true, reviewRequested: true, involved: true },
  autoDiscover: false,
};

const REPOS = [
  { host: 'github.com', owner: 'acme', repo: 'webapp', active: true, shortHost: 'github', connection: 'connected' },
  { host: 'github.com', owner: 'acme', repo: 'site', active: true, shortHost: 'github', connection: 'connected' },
];

let prNum = 0;
function makePr(status: PrRollupStatus, repo = 'acme/webapp'): MonitoredPr {
  prNum += 1;
  const n = prNum;
  return {
    url: `https://github.com/${repo}/pull/${n}`,
    repo,
    number: n,
    title: `PR ${n}`,
    baseRefName: 'main',
    status,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    checks: [],
    addedAt: n,
    lastChecked: n,
    lastStatusChange: n,
    lastSeenAt: undefined,
  };
}

/** A host backed by an in-memory prs map — mirrors the real main process. */
function makeStatefulHost(initial: MonitoredPr[]) {
  const prs = new Map<string, MonitoredPr>(initial.map((p) => [p.url, p]));
  const cacheStore = new Map<string, unknown>();
  const storageStore = new Map<string, unknown>([[SETTINGS_STORAGE_KEY, SETTINGS]]);
  const list = () => Array.from(prs.values()).sort((a, b) => a.addedAt - b.addedAt);

  const call = vi.fn(async (cap: string, ...args: unknown[]) => {
    switch (cap) {
      case 'listPrs':
        return list();
      case 'pollAll':
        return { ok: true, prs: list(), deltas: [] };
      case 'syncRepos':
        return { ok: true, prs: list(), deltas: [] };
      case 'listRepos':
        return { ok: true, repos: REPOS };
      case 'dismissPrs': {
        const { urls } = args[0] as { urls: string[] };
        for (const u of urls) prs.delete(u);
        return { ok: true, prs: list() };
      }
      default:
        return undefined;
    }
  });

  const host = {
    moduleId: 'pr-monitor',
    call: call as unknown as ModuleHost['call'],
    storage: {
      get: async (k: string) => storageStore.get(k),
      set: async (k: string, v: unknown) => void storageStore.set(k, v),
    },
    openExternal: vi.fn(),
    pushInbox: async () => ({ id: 'x' }),
    toast: vi.fn(),
    relaunchSelf: async () => false,
    getActiveProject: () => null,
    getScopedProjectId: () => null,
    listProjects: () => PROJECTS,
    selectProject: () => {},
    launchSession: async () => null,
    on: () => () => {},
    cache: {
      get: <T,>(k: string) => cacheStore.get(k) as T | undefined,
      set: (k: string, v: unknown) => void cacheStore.set(k, v),
      delete: (k: string) => void cacheStore.delete(k),
      refreshBadge: () => {},
    },
  } as unknown as ModuleHost;

  return { host, prs, call };
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.querySelectorAll('.prm-tile-menu, .modal-backdrop, .prm-project-menu-backdrop').forEach((m) => m.remove());
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));
  });
}

function userClick(el: Element) {
  for (const type of ['mousedown', 'mouseup', 'click']) {
    act(() => {
      el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true }));
    });
  }
}

async function mount(initial: MonitoredPr[]) {
  const ctx = makeStatefulHost(initial);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PrMonitorPanel host={ctx.host} />);
  });
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  await flush();
  return { ...ctx, container };
}

describe('PrMonitorPanel header', () => {
  // --- Title + subtitle (AC-LIST-1.1/1.2) ---

  it('shows the "PR Monitor" title and the one-line subtitle', async () => {
    const { container } = await mount([makePr('green')]);
    const title = Array.from(container.querySelectorAll('.prm-header-title h2')).map((h) => h.textContent);
    expect(title).toContain('PR Monitor');
    expect(container.querySelector('.prm-header-subtitle')?.textContent).toBe(
      'Authored, review, and tracked pull requests'
    );
  });

  it('header Settings control opens Settings and becomes a Back-to-PRs control', async () => {
    const { container } = await mount([makePr('green')]);
    const mode = container.querySelector<HTMLButtonElement>('.prm-header-mode')!;
    expect(mode.getAttribute('aria-pressed')).toBe('false');
    expect(mode.textContent).toContain('Settings');
    expect(mode.getAttribute('title')).toBe('Settings');
    userClick(mode);
    await flush();
    expect(mode.getAttribute('aria-pressed')).toBe('true');
    expect(mode.textContent).toContain('PRs');
    expect(container.querySelector('.prm-header-title h2')?.textContent).toBe('Settings');
    expect(container.querySelector('.prm-header-subtitle')?.textContent).toBe(
      'Manage GitHub connections and PR monitoring preferences.'
    );
    expect(container.querySelector('.prm-count-pill')).toBeNull();
    expect(container.querySelector('.prm-split-primary')).toBeNull();
    expect(container.querySelector('.prm-nav-row')?.textContent).toContain('Organizations');
  });

  // --- Sync split control (AC-LIST-2.1/2.7/2.9) ---

  it('primary sync button triggers pollAll on demand', async () => {
    const { container, call } = await mount([makePr('green')]);
    call.mockClear();
    const primary = container.querySelector<HTMLButtonElement>('.prm-split-primary')!;
    expect(primary.getAttribute('title')).toBe('Sync all monitored PRs now'); // AC-LIST-2.9 hover
    userClick(primary);
    await flush();
    expect(call.mock.calls.map((c) => c[0])).toContain('pollAll');
  });

  it('split-control buttons and Add PR expose hover text (AC-LIST-2.9/3.7)', async () => {
    const { container } = await mount([makePr('green')]);
    expect(container.querySelector('.prm-split-primary')?.getAttribute('title')).toBeTruthy();
    expect(container.querySelector('.prm-split-caret')?.getAttribute('title')).toBe(
      'Sync & Filter — choose which repositories to show and sync'
    );
    const pull = Array.from(container.querySelectorAll('.prm-header-actions .prm-btn')).find((b) =>
      b.textContent?.includes('Add PR')
    )!;
    expect(pull.getAttribute('title')).toBeTruthy();
  });

  // --- Sync & Filter picker (AC-LIST-2.2…2.6/2.8) ---

  it('dropdown opens the Sync & Filter picker with All + one entry per active repo', async () => {
    const { container } = await mount([makePr('green')]);
    userClick(container.querySelector('.prm-split-caret')!);
    await flush();
    const menu = document.querySelector('.prm-sync-filter')!;
    expect(menu, 'picker portaled to body').toBeTruthy();
    expect(menu.querySelector('.prm-sync-filter-header strong')?.textContent).toBe('Sync & Filter');
    const items = Array.from(menu.querySelectorAll('.prm-project-menu-item')).map((b) => b.textContent);
    // "All repositories" + acme/webapp + acme/site.
    expect(items[0]).toContain('All repositories');
    expect(items.join(' ')).toContain('acme/webapp');
    expect(items.join(' ')).toContain('acme/site');
    // AC-LIST-2.8: exactly the two active repos + the All row.
    expect(menu.querySelectorAll('.prm-project-menu-item').length).toBe(3);
  });

  it('picker repo selection filters the visible list to the chosen repo (AC-LIST-2.4)', async () => {
    const { container } = await mount([makePr('green', 'acme/webapp'), makePr('green', 'acme/site')]);
    userClick(container.querySelector('.prm-split-caret')!);
    await flush();
    const menu = document.querySelector('.prm-sync-filter')!;
    const webappRow = Array.from(menu.querySelectorAll<HTMLButtonElement>('.prm-project-menu-item')).find((b) =>
      b.textContent?.includes('acme/webapp')
    )!;
    userClick(webappRow);
    await flush();
    // Count pill reflects the filtered scope: only the webapp PR remains.
    expect(container.querySelector('.prm-count-pill')?.textContent).toBe('1');
  });

  it('picker Sync syncs exactly the selected repos (syncRepos), and Close leaves scope', async () => {
    const { container, call } = await mount([makePr('green', 'acme/webapp'), makePr('green', 'acme/site')]);
    userClick(container.querySelector('.prm-split-caret')!);
    await flush();
    const menu = document.querySelector('.prm-sync-filter')!;
    const webappRow = Array.from(menu.querySelectorAll<HTMLButtonElement>('.prm-project-menu-item')).find((b) =>
      b.textContent?.includes('acme/webapp')
    )!;
    userClick(webappRow);
    await flush();
    call.mockClear();
    // Footer sync button now reads "Sync 1".
    const syncBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.prm-sync-filter-footer .prm-btn')).find(
      (b) => b.textContent?.startsWith('Sync')
    )!;
    userClick(syncBtn);
    await flush();
    const syncCall = call.mock.calls.find((c) => c[0] === 'syncRepos');
    expect(syncCall, 'scoped sync dispatched syncRepos').toBeTruthy();
    expect((syncCall![1] as { repos: string[] }).repos).toEqual(['acme/webapp']);
  });

  // --- Pull PR dialog (AC-LIST-3.1/3.2/3.3) ---

  it('Add PR opens a dialog with a Repository selector + PR number input', async () => {
    const { container } = await mount([makePr('green')]);
    const pull = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-header-actions .prm-btn')).find((b) =>
      b.textContent?.includes('Add PR')
    )!;
    userClick(pull);
    await flush();
    const dialog = document.querySelector('.prm-modal[role="dialog"]')!;
    expect(dialog.querySelector('#prm-pull-title')?.textContent).toContain('Add PR');
    const repoSelect = dialog.querySelector<HTMLSelectElement>('select[aria-label="Repository"]')!;
    expect(repoSelect, 'repository selector present').toBeTruthy();
    // AC-LIST-3.3: options are exactly the active repos.
    const opts = Array.from(repoSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(opts.join(' ')).toContain('acme/webapp');
    expect(opts.join(' ')).toContain('acme/site');
    expect(dialog.querySelector('input[type="number"]'), 'PR number input present').toBeTruthy();
    // AC-LIST-3.7: Add + Cancel carry hover text.
    const footerBtns = Array.from(dialog.querySelectorAll('.prm-modal-footer .prm-btn'));
    expect(footerBtns.every((b) => b.getAttribute('title'))).toBe(true);
  });

  // --- Sweep (AC-LIST-4.1/4.2/4.3/4.5) ---

  it('Sweep is absent when no terminal PR is present', async () => {
    const { container } = await mount([makePr('green'), makePr('failed')]);
    const sweep = Array.from(container.querySelectorAll('.prm-header-actions .prm-btn')).find((b) =>
      b.textContent?.includes('Sweep')
    );
    expect(sweep).toBeFalsy();
  });

  it('Sweep appears with terminal PRs, carries hover text, and dismisses exactly Merged/Closed', async () => {
    const active = makePr('green');
    const merged = makePr('closed-merged');
    const closed = makePr('closed-abandoned');
    const { container, call, prs } = await mount([active, merged, closed]);
    const sweep = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-header-actions .prm-btn')).find((b) =>
      b.textContent?.includes('Sweep')
    )!;
    expect(sweep, 'Sweep present with terminal PRs').toBeTruthy();
    expect(sweep.getAttribute('title')).toContain('2'); // AC-LIST-4.5 hover states count
    call.mockClear();
    userClick(sweep);
    await flush();
    const dismiss = call.mock.calls.find((c) => c[0] === 'dismissPrs');
    expect(dismiss, 'sweep dispatched dismissPrs').toBeTruthy();
    // AC-LIST-4.2: exactly the two terminal URLs, not the active one.
    expect((dismiss![1] as { urls: string[] }).urls.sort()).toEqual([merged.url, closed.url].sort());
    expect(prs.has(active.url), 'active PR survives the sweep').toBe(true);
  });
});
