/**
 * @vitest-environment happy-dom
 *
 * Full-panel DOM reproduction for "selecting a project closes the menu but
 * doesn't assign". Mounts the real PrMonitorPanel with a stateful host that
 * mimics the main process (an in-memory prs map serving listPrs / assignProject
 * / pollAll) plus the same cache the background poller writes, then drives the
 * exact user gesture: open a card's project menu, click a project, and assert
 * the assignment sticks visibly (the folder trigger flips to "Assigned to …").
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ModuleHost, ProjectInfo } from './host.js';
import PrMonitorPanel from './PrMonitorPanel.js';
import {
  type MonitoredPr,
  type PrMonitorSettings,
  type SyncHealth,
  DEFAULT_PR_MONITOR_SETTINGS,
  EMPTY_SYNC_HEALTH,
  MONITORED_COUNT_CACHE_KEY,
  MONITORED_PRS_CACHE_KEY,
  SETTINGS_STORAGE_KEY,
} from '../../lib/types.js';

const PROJECTS: ProjectInfo[] = [
  { id: 'proj-a', name: 'Alpha', path: '/repos/alpha' },
  { id: 'proj-b', name: 'Beta', path: '/repos/beta' },
];

const SETTINGS: PrMonitorSettings = {
  pollIntervalMinutes: 15,
  notifyOnChange: false,
  badgeMode: 'unread',
  watchedRepos: [],
  watchedPeople: [],
  relevanceModes: { authored: true, reviewRequested: true, involved: true },
  autoDiscover: false,
};

function makePr(): MonitoredPr {
  return {
    url: 'https://github.com/owner/repo/pull/7',
    repo: 'owner/repo',
    number: 7,
    title: 'A change',
    baseRefName: 'main',
    status: 'green',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    checks: [],
    addedAt: 1,
    lastChecked: 1,
    lastStatusChange: 1,
    lastSeenAt: undefined,
  };
}

/** A host backed by an in-memory prs map — mirrors the real main process. */
function makeStatefulHost(opts: { health?: SyncHealth } = {}) {
  const prs = new Map<string, MonitoredPr>([[makePr().url, makePr()]]);
  const cacheStore = new Map<string, unknown>();
  const storageStore = new Map<string, unknown>([[SETTINGS_STORAGE_KEY, SETTINGS]]);
  const list = () => Array.from(prs.values()).sort((a, b) => a.addedAt - b.addedAt);
  // Mutable health so a resolveRemoteGone can clear the remote-gone entry the
  // way the real main does (kept set / removed repo), and the next poll reflects it.
  let health: SyncHealth = { ...EMPTY_SYNC_HEALTH, ...opts.health };

  const call = vi.fn(async (cap: string, ...args: unknown[]) => {
    switch (cap) {
      case 'listPrs':
        return list();
      case 'pollAll':
        return { ok: true, prs: list(), deltas: [], health };
      case 'getSyncHealth':
        return { ok: true, health };
      case 'resolveRemoteGone': {
        const { repo, action } = args[0] as { repo: string; action: 'remove' | 'keep' };
        const key = repo.toLowerCase();
        health = {
          ...health,
          remoteGone: health.remoteGone.filter((r) => r.toLowerCase() !== key),
          keptGone:
            action === 'keep' ? [...health.keptGone, repo] : health.keptGone,
        };
        return { ok: true };
      }
      case 'assignProject': {
        const [url, projectId] = args as [string, string | null];
        const pr = prs.get(url);
        if (!pr) return { ok: false };
        pr.projectId = projectId ?? undefined;
        return { ok: true, prs: list() };
      }
      case 'markPrAsSeen': {
        const { url } = args[0] as { url: string };
        const pr = prs.get(url);
        if (!pr) return { ok: false };
        pr.lastSeenAt = Date.now();
        return { ok: true, prs: list() };
      }
      case 'markPrAsUnseen': {
        const { url } = args[0] as { url: string };
        const pr = prs.get(url);
        if (!pr) return { ok: false };
        pr.lastSeenAt = undefined;
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

  return { host, prs, cacheStore };
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

async function flush() {
  // Let queued microtasks (the hydrate Promise.all) resolve inside act(), and
  // let any setTimeout(…, 0) (e.g. the menu's deferred dismiss-listener attach)
  // actually fire under REAL timers — the dismiss handler is the suspect path,
  // so it must be live when we click an item.
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

// Phase 2: board view unwired (tile UI is default). These tests query for card/board
// DOM that no longer renders. Tile tests in PrTile.dom.test.tsx cover menu + assignment.
describe.skip('PrMonitorPanel project assignment (DOM, full round-trip)', () => {
  it('assigns the project and reflects it after the click', async () => {
    const { host, prs } = makeStatefulHost();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PrMonitorPanel host={host} />);
    });
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };

    // Hydrate: settings + listPrs resolve, panel renders the board with the card.
    await flush();

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[title="Assign to project"]'
    );
    expect(trigger, 'card + assign trigger rendered after hydrate').toBeTruthy();

    userClick(trigger!);

    const beta = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.prm-project-menu-item')
    ).find((b) => b.textContent === 'Beta');
    expect(beta, 'Beta menu item present').toBeTruthy();

    userClick(beta!);
    // assignProject is async (host.call → setPrs); let it settle.
    await flush();

    // Main-side state must carry the assignment...
    expect(prs.get(makePr().url)?.projectId).toBe('proj-b');

    // ...and the UI must reflect it: the trigger flips to "Assigned to Beta".
    const after = container.querySelector<HTMLButtonElement>(
      'button[title="Assigned to Beta"]'
    );
    expect(after, 'folder trigger shows the assignment').toBeTruthy();
  });

  it('keeps the assignment after a background poll tick overwrites the cache', async () => {
    const { host, prs, cacheStore } = makeStatefulHost();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PrMonitorPanel host={host} />);
    });
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    await flush();

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[title="Assign to project"]'
    )!;
    userClick(trigger);
    const beta = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.prm-project-menu-item')
    ).find((b) => b.textContent === 'Beta')!;
    userClick(beta);
    await flush();

    // Simulate the background poller writing a fresh snapshot to the cache, then
    // wait for the panel's 100ms mirror tick to fire (real timer). The assignment
    // must survive — this is the path the main-side refreshOne fix protects.
    act(() => {
      cacheStore.set(
        MONITORED_PRS_CACHE_KEY,
        Array.from(prs.values()).map((p) => ({ ...p }))
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });

    const after = container.querySelector<HTMLButtonElement>(
      'button[title="Assigned to Beta"]'
    );
    expect(after, 'assignment survives the cache mirror tick').toBeTruthy();
  });
});

describe('PrMonitorPanel fresh-poll on open (DOM)', () => {
  it('polls for live status once on mount, not just listPrs from storage', async () => {
    // Reported bug: opening the app showed a stale "13m ago" board; clicking
    // Refresh fixed it. On mount the panel only called `listPrs` (reads stored
    // data) and relied on the headless background poller for freshness — which
    // doesn't reliably fire on open. The panel must itself run ONE `pollAll`
    // after hydration so "open the app" === "see current state".
    const { host } = makeStatefulHost();
    const call = host.call as unknown as ReturnType<typeof vi.fn>;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PrMonitorPanel host={host} />);
    });
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    await flush();

    const calls = call.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls, 'hydrate still loads stored list').toContain('listPrs');
    expect(calls, 'a fresh poll runs on mount').toContain('pollAll');
  });

  it('polls exactly once on mount (no repeated polling without a refresh click)', async () => {
    const { host } = makeStatefulHost();
    const call = host.call as unknown as ReturnType<typeof vi.fn>;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PrMonitorPanel host={host} />);
    });
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    await flush();
    // Let a couple of the panel's 100ms cache-mirror ticks pass — they must NOT
    // each trigger a poll (that would hammer gh). Only the one mount poll.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });

    const pollCount = call.mock.calls.filter((c: unknown[]) => c[0] === 'pollAll').length;
    expect(pollCount, 'exactly one mount poll, no runaway polling').toBe(1);
  });

  it('migrates persisted activeSubTab board→prs on hydrate', async () => {
    const { host } = makeStatefulHost();
    const storageStore = new Map<string, unknown>([
      [SETTINGS_STORAGE_KEY, { ...SETTINGS }],
      ['activeSubTab', 'board'],
    ]);
    (host.storage as { get: (k: string) => Promise<unknown> }).get = async (k: string) =>
      storageStore.get(k);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PrMonitorPanel host={host} />);
    });
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    await flush();

    const mode = container.querySelector<HTMLButtonElement>('.prm-header-mode');
    expect(mode?.getAttribute('aria-pressed')).toBe('false');
    expect(mode?.textContent).toContain('Settings');
    expect(container.querySelector('.prm-count-pill')).toBeTruthy();
    expect(container.querySelector('.prm-settings-nav')).toBeFalsy();
    expect(container.querySelector('.prm-board'), 'legacy board tab restores the kanban').toBeTruthy();
  });

  it('hydrates legacy settings (no relevanceModes) with defaults so Settings tab does not crash', async () => {
    // Pre-redesign stores persisted PrMonitorSettings WITHOUT watchedPeople /
    // watchedRepos / relevanceModes / autoDiscover / age thresholds. SettingsView
    // reads settings.relevanceModes.authored unconditionally — hydrating the raw
    // legacy object would throw "Cannot read properties of undefined". The panel
    // must merge persisted settings over DEFAULT_PR_MONITOR_SETTINGS.
    const { host } = makeStatefulHost();
    const legacySettings = {
      pollIntervalMinutes: 5,
      terminalBehavior: 'keep-collapsed',
      notifyOnChange: false,
      displayMode: 'both',
      badgeMode: 'unseen-changes',
    };
    const storageStore = new Map<string, unknown>([[SETTINGS_STORAGE_KEY, legacySettings]]);
    (host.storage as { get: (k: string) => Promise<unknown> }).get = async (k: string) =>
      storageStore.get(k);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PrMonitorPanel host={host} />);
    });
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    await flush();

    // Switch to Settings — this mounts SettingsView, which crashed
    // pre-fix when relevanceModes was undefined.
    const settingsBtn = container.querySelector<HTMLButtonElement>('.prm-header-mode');
    expect(settingsBtn, 'Settings header control present').toBeTruthy();
    userClick(settingsBtn!);
    await flush();

    // The grouped Settings shell mounts from merged defaults, no throw. The
    // panel header names the mode; the left-nav is always present.
    expect(settingsBtn?.getAttribute('aria-pressed')).toBe('true');
    const settingsHeader = Array.from(container.querySelectorAll('h2')).find(
      (h) => h.textContent === 'Settings'
    );
    expect(settingsHeader, 'Settings view rendered without crashing').toBeTruthy();
    const orgNav = Array.from(container.querySelectorAll('.prm-nav-row')).find((b) =>
      b.textContent?.includes('Organizations')
    );
    expect(orgNav, 'Settings left-nav rendered').toBeTruthy();
  });

  it('saving a renderer preference preserves main-owned collections (persistence bug)', async () => {
    // The `settings` KV key is co-owned: the renderer owns preferences, main owns
    // discovered collections (organizations / repositories / author). A naive
    // save from the renderer would clobber the main-owned fields with its stale
    // in-memory copy — the "repositories not saved from last session" bug. The
    // panel's saveSettings re-reads storage and grafts the main-owned fields back.
    const { host } = makeStatefulHost();
    const MAIN_REPOS = [
      { host: 'github.com', owner: 'acme', repo: 'widgets', orgLogin: 'acme', createdAt: 1 },
    ];
    // Storage carries repositories that the panel's hydrated `settings` does NOT.
    const storageStore = new Map<string, unknown>([
      [SETTINGS_STORAGE_KEY, { ...SETTINGS, notifyInApp: true, notifyOnChange: true }],
    ]);
    (host.storage as { get: (k: string) => Promise<unknown> }).get = async (k: string) =>
      storageStore.get(k);
    (host.storage as { set: (k: string, v: unknown) => Promise<void> }).set = async (
      k: string,
      v: unknown
    ) => {
      // On the FIRST save-read, storage already holds main-owned repositories
      // written by main after the panel hydrated (the real-world race).
      storageStore.set(k, v);
    };
    // Seed the main-owned collection AFTER the panel will have hydrated.
    storageStore.set(SETTINGS_STORAGE_KEY, {
      ...SETTINGS,
      notifyInApp: true,
      notifyOnChange: true,
      repositories: MAIN_REPOS,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PrMonitorPanel host={host} />);
    });
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    await flush();

    // Go to Settings → Notifications and flip In-app notifications (a pref save).
    const settingsBtn = container.querySelector<HTMLButtonElement>('.prm-header-mode')!;
    userClick(settingsBtn);
    await flush();

    const notifNav = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-nav-row')).find((b) =>
      b.textContent?.includes('Notifications')
    )!;
    userClick(notifNav);
    await flush();

    const box = Array.from(container.querySelectorAll('label'))
      .find((l) => l.textContent?.includes('In-app notifications'))!
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    userClick(box);
    await flush();

    // The persisted settings still carry the main-owned repositories.
    const persisted = storageStore.get(SETTINGS_STORAGE_KEY) as { repositories?: unknown[] };
    expect(persisted.repositories, 'main-owned repositories survived a renderer pref save').toEqual(
      MAIN_REPOS
    );
  });

  it('migrates persisted activeSubTab list→prs on hydrate', async () => {
    const { host } = makeStatefulHost();
    const storageStore = new Map<string, unknown>([
      [SETTINGS_STORAGE_KEY, { ...SETTINGS }],
      ['activeSubTab', 'list'],
    ]);
    (host.storage as { get: (k: string) => Promise<unknown> }).get = async (k: string) =>
      storageStore.get(k);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PrMonitorPanel host={host} />);
    });
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    await flush();

    const mode = container.querySelector<HTMLButtonElement>('.prm-header-mode');
    expect(mode?.getAttribute('aria-pressed')).toBe('false');
    expect(mode?.textContent).toContain('Settings');
    expect(container.querySelector('.prm-count-pill')).toBeTruthy();
    expect(container.querySelector('.prm-settings-nav')).toBeFalsy();
    expect(container.querySelector('.prm-tile-list'), 'legacy list tab restores the tile list').toBeTruthy();
    expect(container.querySelector('.prm-board')).toBeFalsy();
  });

  it('restores a persisted listView preference', async () => {
    const { host } = makeStatefulHost();
    const storageStore = new Map<string, unknown>([
      [SETTINGS_STORAGE_KEY, { ...SETTINGS }],
      ['listView', 'list'],
    ]);
    (host.storage as { get: (k: string) => Promise<unknown> }).get = async (k: string) =>
      storageStore.get(k);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PrMonitorPanel host={host} />);
    });
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    await flush();

    expect(container.querySelector('.prm-tile-list')).toBeTruthy();
    expect(container.querySelector('.prm-board')).toBeFalsy();
  });
});

// Unseen badge toggle re-covered by PrTile.dom.test.tsx
// (toggles unseen→seen, seen→unseen, badge always clickable).

describe('PrMonitorPanel app-scoped cross-project monitor (AC-NAV-2.2, AC-NAV-2.3)', () => {
  it('always shows all PRs, never filters to a scoped project', async () => {
    const { host } = makeStatefulHost();
    // Mock getScopedProjectId to simulate mounting in a project tab
    (host.getScopedProjectId as any) = () => 'proj-a';

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PrMonitorPanel host={host} />);
    });
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    await flush();

    // The "Filtered to X" pill must NOT render (AC-NAV-2.3)
    const scopePill = container.querySelector('.prm-scope-pill');
    expect(scopePill, 'no "Filtered to X" pill — view is never scoped').toBeFalsy();

    // The board (default) must show ALL prs, not just proj-a's
    const cards = container.querySelectorAll('.prm-board-card');
    expect(cards.length, 'shows the full pr set').toBe(1);
  });

  it('header Settings control has a tooltip', async () => {
    const { host } = makeStatefulHost();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PrMonitorPanel host={host} />);
    });
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    await flush();

    const mode = container.querySelector<HTMLButtonElement>('.prm-header-mode');
    expect(mode, 'Settings header control rendered').toBeTruthy();
    expect(mode!.getAttribute('title'), 'Settings control has tooltip').toBeTruthy();
  });
});

describe('PrMonitorPanel sync-health clue + Remove/Keep prompt (R-REPO-013/015/016)', () => {
  function mount(host: ModuleHost) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PrMonitorPanel host={host} />);
    });
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    return container;
  }

  it('healthy → no clue, no prompt', async () => {
    const { host } = makeStatefulHost();
    const container = mount(host);
    await flush();
    expect(container.querySelector('.prm-sync-clue')).toBeFalsy();
    expect(container.querySelector('.prm-sync-prompt')).toBeFalsy();
  });

  it('AC-REPO-13.5: a disconnected host shows ONE clue with an Open Settings action', async () => {
    const { host } = makeStatefulHost({
      health: { ...EMPTY_SYNC_HEALTH, disconnectedHosts: ['github.com'], outageHosts: ['git.soma'] },
    });
    const container = mount(host);
    await flush();
    const clues = container.querySelectorAll('.prm-sync-clue');
    expect(clues.length, 'exactly one clue').toBe(1);
    expect(clues[0].className).toContain('prm-sync-clue--disconnect');
    const action = clues[0].querySelector<HTMLButtonElement>('.prm-sync-clue-action');
    expect(action?.textContent).toBe('Open Settings');
    // Clicking it switches to Settings.
    userClick(action!);
    await flush();
    const mode = container.querySelector<HTMLButtonElement>('.prm-header-mode');
    expect(mode?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.prm-nav-row')?.textContent).toContain('Organizations');
  });

  it('a transient outage shows an informational clue with no action', async () => {
    const { host } = makeStatefulHost({
      health: { ...EMPTY_SYNC_HEALTH, outageHosts: ['github.com'] },
    });
    const container = mount(host);
    await flush();
    const clue = container.querySelector('.prm-sync-clue');
    expect(clue?.className).toContain('prm-sync-clue--outage');
    expect(clue?.querySelector('.prm-sync-clue-action'), 'outage has no action').toBeFalsy();
  });

  it('R-REPO-016: a remote-gone repo shows a Remove/Keep prompt; Keep clears it', async () => {
    const { host } = makeStatefulHost({
      health: { ...EMPTY_SYNC_HEALTH, remoteGone: ['acme/widgets'] },
    });
    const container = mount(host);
    await flush();
    const prompt = container.querySelector('.prm-sync-prompt');
    expect(prompt, 'prompt rendered').toBeTruthy();
    expect(prompt?.textContent).toContain('acme/widgets');
    const keep = Array.from(
      prompt!.querySelectorAll<HTMLButtonElement>('.prm-sync-prompt-actions button')
    ).find((b) => b.textContent === 'Keep');
    expect(keep, 'Keep button present').toBeTruthy();
    userClick(keep!);
    await flush();
    expect(container.querySelector('.prm-sync-prompt'), 'prompt clears after Keep').toBeFalsy();
  });
});

/**
 * Nav-badge honors the persisted badgeMode WITHOUT a Settings toggle.
 *
 * Reported bug: with badgeMode='unread' and 2 unread PRs after a Sync, the nav
 * badge showed the TOTAL count; toggling Settings back and forth fixed it. Root
 * cause: the badge resolves badgeMode from host.cache('settings'), which only
 * SettingsView.update (and the always-on background poller) seeded — the panel's
 * own hydrate + Sync (pollNow) never seeded it nor called refreshBadge, so the
 * badge fell back to its cold-start 'total' default. The panel must itself seed
 * the settings cache + refresh the badge on mount and after a Sync.
 */
describe('PrMonitorPanel nav-badge seeding (badgeMode honored without a toggle)', () => {
  // Mirror renderer-entry's navBadge resolution so the assertion proves the same
  // value the sidebar would render, reading the same cache the panel seeds.
  function resolveBadge(cache: Map<string, unknown>): number | null {
    const settings = cache.get('settings') as PrMonitorSettings | undefined;
    const badgeMode = settings?.badgeMode ?? DEFAULT_PR_MONITOR_SETTINGS.badgeMode;
    if (badgeMode === 'unread') {
      const prs = (cache.get(MONITORED_PRS_CACHE_KEY) as MonitoredPr[] | undefined) ?? [];
      const unseen = prs.filter((pr) => pr.lastStatusChange > (pr.lastSeenAt ?? pr.addedAt)).length;
      return unseen > 0 ? unseen : null;
    }
    const total = (cache.get(MONITORED_COUNT_CACHE_KEY) as number | undefined) ?? 0;
    return total > 0 ? total : null;
  }

  function makeBadgeHost() {
    // Two PRs TOTAL, exactly ONE unread — so total (2) and unread (1) differ and
    // the resolved badge value proves WHICH branch ran. PR1 unread
    // (lastStatusChange 2 > lastSeenAt 1); PR2 read (lastStatusChange 2, seen at 3).
    const prs: MonitoredPr[] = [
      { ...makePr(), url: 'https://github.com/o/r/pull/1', number: 1, addedAt: 1, lastStatusChange: 2, lastSeenAt: 1 },
      { ...makePr(), url: 'https://github.com/o/r/pull/2', number: 2, addedAt: 1, lastStatusChange: 2, lastSeenAt: 3 },
    ];
    const cache = new Map<string, unknown>();
    const refreshBadge = vi.fn();
    const call = vi.fn(async (cap: string) => {
      switch (cap) {
        case 'listPrs':
          return prs;
        case 'pollAll':
          return { ok: true, prs, deltas: [], health: { ...EMPTY_SYNC_HEALTH } };
        case 'getSyncHealth':
          return { ok: true, health: { ...EMPTY_SYNC_HEALTH } };
        default:
          return undefined;
      }
    });
    const host = {
      moduleId: 'pr-monitor',
      call: call as unknown as ModuleHost['call'],
      storage: {
        // badgeMode 'unread' persisted — the badge must honor it on first paint.
        get: async (k: string) =>
          k === SETTINGS_STORAGE_KEY ? { ...SETTINGS, badgeMode: 'unread' } : undefined,
        set: async () => {},
      },
      openExternal: vi.fn(),
      pushInbox: async () => ({ id: 'x' }),
      toast: vi.fn(),
      getActiveProject: () => null,
      getScopedProjectId: () => null,
      listProjects: () => PROJECTS,
      selectProject: () => {},
      on: () => () => {},
      cache: {
        get: <T,>(k: string) => cache.get(k) as T | undefined,
        set: (k: string, v: unknown) => void cache.set(k, v),
        delete: (k: string) => void cache.delete(k),
        refreshBadge,
      },
    } as unknown as ModuleHost;
    return { host, cache, refreshBadge };
  }

  it('seeds the settings cache + refreshes the badge on mount so the badge shows unread, not total', async () => {
    const { host, cache, refreshBadge } = makeBadgeHost();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PrMonitorPanel host={host} />);
    });
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    await flush();

    // The panel seeded the persisted badgeMode into the cache the badge reads...
    expect((cache.get('settings') as PrMonitorSettings).badgeMode).toBe('unread');
    // ...and asked the shell to re-evaluate the badge.
    expect(refreshBadge).toHaveBeenCalled();
    // The badge resolves to the UNREAD count (1), NOT the total (2) — proving the
    // 'unread' branch ran. Before the fix this fell back to total=2.
    expect(resolveBadge(cache), 'badge honors unread mode after mount').toBe(1);
  });

  it('escapes the loading spinner even when the host cache lacks refreshBadge (older shell)', async () => {
    // Regression: the badge-seeding code calls host.cache.refreshBadge() during
    // hydrate. On an older host shell whose cache API predates refreshBadge, an
    // unguarded call throws mid-hydrate — and because the hydrate promise had no
    // .catch, setHydrated(true) never ran and the panel spun forever. The panel
    // must still finish hydration (paint past the "Loading PR Monitor…" spinner).
    const { host } = makeBadgeHost();
    // Simulate the older shell: cache has get/set/delete but NO refreshBadge.
    (host as unknown as { cache: Record<string, unknown> }).cache = {
      get: () => undefined,
      set: () => {},
      delete: () => {},
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PrMonitorPanel host={host} />);
    });
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    await flush();

    // Hydration completed: the loading spinner is gone.
    expect(container.textContent ?? '').not.toContain('Loading PR Monitor');
  });

  it('delivers inbox notifications for an interesting status transition from manual Sync', async () => {
    const { host } = makeBadgeHost();
    const pushInbox = vi.fn(async () => ({ id: 'inbox-entry' }));
    const settings: PrMonitorSettings = {
      ...SETTINGS,
      notifyInApp: false,
      sendToInbox: true,
      repositories: [{
        owner: 'owner', repo: 'repo', host: 'github.com', orgLogin: 'owner',
        active: true, tisPreset: 'standard', createdAt: 0, notifyInApp: true,
      }],
    };
    const synced = { ...makePr(), projectId: 'proj-a', status: 'green' };
    (host as unknown as { storage: ModuleHost['storage']; pushInbox: typeof pushInbox; call: ModuleHost['call'] }).storage = {
      get: async <T,>(key: string) => (key === SETTINGS_STORAGE_KEY ? settings : undefined) as T | undefined,
      set: async () => {},
    };
    (host as unknown as { pushInbox: typeof pushInbox }).pushInbox = pushInbox;
    (host as unknown as { call: ModuleHost['call'] }).call = async <T,>(cap: string) => {
      if (cap === 'listPrs') return [synced] as T;
      if (cap === 'getSyncHealth') return { ok: true, health: { ...EMPTY_SYNC_HEALTH } } as T;
      if (cap === 'pollAll') {
        return {
          ok: true,
          prs: [synced],
          deltas: [{ url: synced.url, oldStatus: 'yellow', newStatus: 'green', pr: synced }],
          health: { ...EMPTY_SYNC_HEALTH },
        } as T;
      }
      return undefined as T;
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<PrMonitorPanel host={host} />));
    cleanup = () => { act(() => root.unmount()); container.remove(); };
    await flush();

    const sync = Array.from(container.querySelectorAll('button')).find((button) => button.title === 'Sync all monitored PRs now');
    expect(sync).toBeTruthy();
    await act(async () => { sync!.click(); await flush(); });
    expect(pushInbox).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-a' }));
  });
});
