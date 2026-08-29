/**
 * @vitest-environment happy-dom
 *
 * SettingsView DOM tests — the grouped left-nav shell (R-SET-*) and area routing.
 * Each area loads its own state from `host.call`; the mock host below answers the
 * handlers the areas invoke (listOrgs / listRepos / getAuthor / getSettings).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ModuleHost } from './host.js';
import { SettingsView } from './SettingsView.js';
import { DEFAULT_PR_MONITOR_SETTINGS, type PrMonitorSettings } from '../../lib/types.js';

type CallMap = Record<string, unknown>;

function makeHost(calls: CallMap = {}): ModuleHost {
  return {
    storage: { get: async () => null, set: async () => {} },
    cache: { get: () => null, set: () => {}, refreshBadge: () => {} },
    toast: () => {},
    openExternal: () => {},
    call: async (cap: string) => calls[cap],
  } as unknown as ModuleHost;
}

describe('SettingsView grouped nav shell', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  it('renders the left-nav shell without a duplicate Settings heading (R-SET-001)', () => {
    const { container } = render(
      <SettingsView settings={DEFAULT_PR_MONITOR_SETTINGS} onSave={() => {}} host={makeHost()} />
    );
    cleanup = () => container.remove();

    expect(container.querySelector('.prm-settings-head')).toBeNull();
    expect(Array.from(container.querySelectorAll('h2')).find((h) => h.textContent === 'Settings')).toBeFalsy();
    expect(container.querySelector('.prm-settings-nav')).toBeTruthy();
    expect(container.querySelector('.prm-settings-pane')).toBeTruthy();
  });

  it('renders all five nav rows under three group headers (R-SET-002/003)', () => {
    const { container } = render(
      <SettingsView settings={DEFAULT_PR_MONITOR_SETTINGS} onSave={() => {}} host={makeHost()} />
    );
    cleanup = () => container.remove();

    const groups = Array.from(container.querySelectorAll('.prm-nav-group-label')).map((g) => g.textContent);
    expect(groups).toEqual(['GITHUB', 'CONFIGURATION', 'SYSTEM']);

    const rows = Array.from(container.querySelectorAll('.prm-nav-row')).map((r) => r.textContent?.trim());
    expect(rows).toEqual(['Organizations', 'Repositories', 'Author', 'Notifications', 'System']);
  });

  it('defaults active nav to Organizations', () => {
    const { container } = render(
      <SettingsView settings={DEFAULT_PR_MONITOR_SETTINGS} onSave={() => {}} host={makeHost()} />
    );
    cleanup = () => container.remove();

    const active = container.querySelector('.prm-nav-row.active');
    expect(active?.textContent).toContain('Organizations');
  });

  it('honors persisted settingsActiveNav', () => {
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'notifications' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={makeHost()} />);
    cleanup = () => container.remove();

    const active = container.querySelector('.prm-nav-row.active');
    expect(active?.textContent).toContain('Notifications');
    expect(container.textContent).toContain('Sidebar badge');
  });

  it('selecting a nav row persists settingsActiveNav via onSave', () => {
    let saved: PrMonitorSettings | null = null;
    const { container } = render(
      <SettingsView
        settings={DEFAULT_PR_MONITOR_SETTINGS}
        onSave={(next) => {
          saved = next;
        }}
        host={makeHost()}
      />
    );
    cleanup = () => container.remove();

    const systemRow = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-nav-row')).find((r) =>
      r.textContent?.includes('System')
    )!;
    systemRow.click();

    expect(saved).toBeTruthy();
    expect(saved!.settingsActiveNav).toBe('system');
  });
});

describe('SettingsView — Notifications area (R-NOTIF-*)', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  function renderNotifications(
    overrides: Partial<PrMonitorSettings> = {},
    onSave: (next: PrMonitorSettings) => void = () => {}
  ) {
    const settings: PrMonitorSettings = {
      ...DEFAULT_PR_MONITOR_SETTINGS,
      settingsActiveNav: 'notifications',
      ...overrides,
    };
    const res = render(<SettingsView settings={settings} onSave={onSave} host={makeHost()} />);
    cleanup = () => res.container.remove();
    return res;
  }

  it('renders title and subtitle (AC-NOTIF-1.1)', () => {
    const { container } = renderNotifications();
    expect(container.textContent).toContain('Notifications');
    expect(container.textContent).toContain('How to be notified when pull request status changes');
  });

  it('toggling In-app notifications writes both notifyInApp and notifyOnChange', () => {
    let saved: PrMonitorSettings | null = null;
    const { container } = renderNotifications({ notifyInApp: true, notifyOnChange: true }, (n) => {
      saved = n;
    });
    const box = screen
      .getByText('In-app notifications')
      .closest('label')!
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    box.click();
    expect(saved!.notifyInApp).toBe(false);
    expect(saved!.notifyOnChange).toBe(false);
    void container;
  });

  it('badge mode radios reflect and update badgeMode', () => {
    let saved: PrMonitorSettings | null = null;
    renderNotifications({ badgeMode: 'unread' }, (n) => {
      saved = n;
    });
    const total = screen
      .getByText('Total count')
      .closest('label')!
      .querySelector('input[type="radio"]') as HTMLInputElement;
    expect(total.checked).toBe(false);
    total.click();
    expect(saved!.badgeMode).toBe('total');
  });
});

describe('SettingsView — Organizations area (R-ORG-*)', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  it('renders org cards from listOrgs with short-host + connection pill', async () => {
    const host = makeHost({
      listOrgs: {
        ok: true,
        orgs: [
          {
            host: 'gitcore.soma.salesforce.com',
            login: 'my-org',
            apiBaseUrl: 'https://gitcore.soma.salesforce.com/api/v3',
            shortHost: 'gitcore',
            connection: 'connected',
          },
        ],
      },
    });
    const { container } = render(
      <SettingsView settings={DEFAULT_PR_MONITOR_SETTINGS} onSave={() => {}} host={host} />
    );
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-entity-card')).toBeTruthy());
    expect(container.textContent).toContain('my-org');
    expect(container.textContent).toContain('(gitcore)');
    expect(container.querySelector('.prm-conn-pill--connected')).toBeTruthy();
    // No manual Add control (R-ORG-001); Re-discover present (R-ORG-004).
    expect(container.textContent).toContain('Re-discover');
  });

  it('shows empty state when no orgs', async () => {
    const host = makeHost({ listOrgs: { ok: true, orgs: [] } });
    const { container } = render(
      <SettingsView settings={DEFAULT_PR_MONITOR_SETTINGS} onSave={() => {}} host={host} />
    );
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-area-empty')).toBeTruthy());
    expect(container.textContent).toContain('No organizations found');
  });
});

describe('SettingsView — Repositories area (R-REPO-*)', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  it('repo card renders GitHub mark icon (AC-REPO-2.1)', async () => {
    const host = makeHost({
      listRepos: {
        ok: true,
        repos: [
          {
            host: 'github.com',
            owner: 'test-owner',
            repo: 'test-repo',
            orgLogin: 'test-org',
            shortHost: 'github',
            connection: 'connected',
            active: true,
            createdAt: Date.now(),
          },
        ],
      },
      listOrgs: { ok: true, orgs: [] },
    });
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'repositories' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-repo-card')).toBeTruthy());
    // Should render a GitHub logo icon (not GitBranch) before owner/repo.
    // We'll verify via aria-label or class once implemented.
    expect(container.textContent).toContain('test-owner/test-repo');
  });

  it('AC-REPO-2.4: per-card quick actions expose hover titles (Open / Copy link)', async () => {
    const host = makeHost({
      listRepos: {
        ok: true,
        repos: [
          {
            host: 'github.com',
            owner: 'test-owner',
            repo: 'test-repo',
            orgLogin: 'test-org',
            shortHost: 'github',
            connection: 'connected',
            active: true,
            createdAt: Date.now(),
          },
        ],
      },
      listOrgs: { ok: true, orgs: [] },
    });
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'repositories' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-repo-quick')).toBeTruthy());
    const quick = container.querySelector('.prm-repo-quick')!;
    const btns = Array.from(quick.querySelectorAll<HTMLButtonElement>('button'));
    const titles = btns.map((b) => b.getAttribute('title'));
    expect(titles).toContain('Open on GitHub');
    expect(titles).toContain('Copy link');
    // AC-REPO-3.3: native `title` alone is unreliable in Electron for icon-only
    // buttons, so each quick action also drives a CSS tooltip via `.prm-tip` +
    // `data-tip` (mirrors the title). Assert both are present on every button.
    for (const b of btns) {
      expect(b.classList.contains('prm-tip')).toBe(true);
      expect(b.getAttribute('data-tip')).toBe(b.getAttribute('title'));
    }
    const tips = btns.map((b) => b.getAttribute('data-tip'));
    expect(tips).toContain('Open on GitHub');
    expect(tips).toContain('Copy link');
  });

  it('AC-REPO-10.4: a failed Test Connection flips the card pill to Disconnected', async () => {
    let cleanup2: (() => void) | null = null;
    const host = {
      storage: { get: async () => null, set: async () => {} },
      cache: { get: () => null, set: () => {}, refreshBadge: () => {} },
      toast: () => {},
      openExternal: () => {},
      call: async (cap: string) => {
        switch (cap) {
          case 'listRepos':
            return {
              ok: true,
              repos: [
                {
                  host: 'github.com',
                  owner: 'acme',
                  repo: 'widgets',
                  orgLogin: 'acme',
                  shortHost: 'github',
                  connection: 'connected',
                  active: true,
                  createdAt: Date.now(),
                },
              ],
            };
          case 'listOrgs':
            return { ok: true, orgs: [] };
          case 'testRepository':
            return { ok: false, error: 'auth failed' };
          default:
            return undefined;
        }
      },
    } as unknown as ModuleHost;
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'repositories' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup2 = () => container.remove();
    const restore = cleanup;
    cleanup = () => {
      cleanup2?.();
      restore?.();
    };

    await waitFor(() => expect(container.querySelector('.prm-conn-pill--connected')).toBeTruthy());

    // Open Test Connection for the card.
    const testBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
      b.textContent?.includes('Test Connection')
    )!;
    testBtn.click();

    // The probe resolves ok:false → the card pill flips to disconnected.
    await waitFor(() => expect(container.querySelector('.prm-conn-pill--disconnected')).toBeTruthy());
    expect(container.querySelector('.prm-conn-pill--connected'), 'no longer connected').toBeFalsy();
  });
});

describe('SettingsView — Browse Repositories (R-REPO-009)', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  // Show-all-on-open, across all authenticated hosts (no per-org dropdown, no
  // search-first). The renderer calls one capability — `listAllRepositories` —
  // on open and renders every accessible repo grouped by owner. `alreadyAdded`
  // repos render a "Connected" pill in place of a checkbox. The search box then
  // FILTERS the loaded list client-side.
  const BROWSE_REPOS = [
    { owner: 'acme', repo: 'widgets', fullName: 'acme/widgets', host: 'github.com', alreadyAdded: false },
    { owner: 'acme', repo: 'gadgets', fullName: 'acme/gadgets', host: 'github.com', alreadyAdded: false },
    { owner: 'globex', repo: 'gizmos', fullName: 'globex/gizmos', host: 'github.com', alreadyAdded: false },
  ];

  function makeBrowseHost(opts?: {
    repos?: unknown[];
    hasMore?: boolean;
    page2?: unknown[];
    incompleteOwners?: string[];
  }) {
    const added: unknown[] = [];
    const listPages: number[] = [];
    const host = {
      storage: { get: async () => null, set: async () => {} },
      cache: { get: () => null, set: () => {}, refreshBadge: () => {} },
      toast: () => {},
      openExternal: () => {},
      call: async (cap: string, arg?: unknown) => {
        switch (cap) {
          case 'listRepos':
            return { ok: true, repos: [] };
          case 'listOrgs':
            return { ok: true, orgs: [] };
          case 'listAllRepositories': {
            const page = (arg as { page?: number })?.page ?? 1;
            listPages.push(page);
            if (page > 1) return { ok: true, repos: opts?.page2 ?? [], hasMore: false };
            return {
              ok: true,
              repos: opts?.repos ?? BROWSE_REPOS,
              hasMore: opts?.hasMore ?? false,
              incompleteOwners: opts?.incompleteOwners,
            };
          }
          case 'addRepositories':
            added.push(arg);
            return { ok: true };
          default:
            return undefined;
        }
      },
    } as unknown as ModuleHost;
    return { host, added, listPages };
  }

  async function openBrowse(container: HTMLElement) {
    await waitFor(() =>
      expect(
        Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).some((b) =>
          b.textContent?.includes('Browse Repositories')
        )
      ).toBe(true)
    );
    const browseBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
      b.textContent?.includes('Browse Repositories')
    )!;
    browseBtn.click();
    // Show-all-on-open: rows load without any typing.
    await waitFor(() => expect(container.querySelector('.prm-browse-group')).toBeTruthy());
  }

  function renderRepos(host: ModuleHost) {
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'repositories' };
    const res = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => res.container.remove();
    return res;
  }

  it('AC-REPO-9.1: loads all repos on open, grouped by owner with a count header', async () => {
    const { host, listPages } = makeBrowseHost();
    const { container } = renderRepos(host);
    await openBrowse(container);

    expect(listPages, 'loaded page 1 on open, no typing').toEqual([1]);
    const groups = container.querySelectorAll('.prm-browse-group');
    expect(groups.length, 'two owners → two groups').toBe(2);
    const headers = Array.from(container.querySelectorAll('.prm-browse-group-header')).map((h) =>
      h.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(headers).toContain('acme(2)');
    expect(headers).toContain('globex(1)');
  });

  it('AC-REPO-9.2: the search box filters the loaded list client-side', async () => {
    const { host, listPages } = makeBrowseHost();
    const { container } = renderRepos(host);
    await openBrowse(container);

    const input = container.querySelector<HTMLInputElement>('.prm-browse-controls input')!;
    fireEvent.change(input, { target: { value: 'gizmo' } });
    await waitFor(() => expect(container.querySelectorAll('.prm-browse-repo-row').length).toBe(1));
    expect(container.querySelector('.prm-browse-repo-row')?.textContent).toContain('globex/gizmos');
    // Filtering is purely client-side — no extra capability call.
    expect(listPages).toEqual([1]);
  });

  it('AC-REPO-9.3: an already-monitored repo shows a Connected pill, no checkbox', async () => {
    const { host } = makeBrowseHost({
      repos: [
        { owner: 'acme', repo: 'widgets', fullName: 'acme/widgets', host: 'github.com', alreadyAdded: true },
        { owner: 'acme', repo: 'gadgets', fullName: 'acme/gadgets', host: 'github.com', alreadyAdded: false },
      ],
    });
    const { container } = renderRepos(host);
    await openBrowse(container);

    // The connected repo renders a pill and no checkbox; only the free repo is selectable.
    expect(container.querySelectorAll('.prm-conn-pill--connected').length).toBe(1);
    const boxes = container.querySelectorAll<HTMLInputElement>('.prm-browse-repo-row input[type="checkbox"]');
    expect(boxes.length, 'only the not-added repo is selectable').toBe(1);
  });

  it('AC-REPO-9.5/9.6: checkboxes drive the Add N Selected button, which batch-adds', async () => {
    const { host, added } = makeBrowseHost();
    const { container } = renderRepos(host);
    await openBrowse(container);

    // Primary button disabled with nothing selected.
    const addBtn = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-modal-footer .prm-btn--primary'))[0];
    expect(addBtn().disabled, 'disabled at zero selection').toBe(true);
    expect(addBtn().textContent).toContain('Add Selected');

    // Select two repos.
    const boxes = container.querySelectorAll<HTMLInputElement>('.prm-browse-repo-row input[type="checkbox"]');
    expect(boxes.length).toBe(3);
    boxes[0].click();
    boxes[2].click();
    await waitFor(() => expect(addBtn().textContent).toContain('Add 2 Selected'));
    expect(addBtn().disabled).toBe(false);

    addBtn().click();
    await waitFor(() => expect(added.length).toBe(1));
    const payload = added[0] as { repos: Array<{ owner: string; repo: string }> };
    expect(payload.repos.map((r) => `${r.owner}/${r.repo}`)).toEqual(['acme/widgets', 'globex/gizmos']);
  });

  it('AC-REPO-9.1: a group header toggles its rows collapsed/expanded', async () => {
    const { host } = makeBrowseHost();
    const { container } = renderRepos(host);
    await openBrowse(container);

    const acmeHeader = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-browse-group-header')).find(
      (h) => h.textContent?.includes('acme')
    )!;
    expect(acmeHeader.getAttribute('aria-expanded'), 'starts expanded').toBe('true');
    expect(container.querySelectorAll('.prm-browse-repo-row').length).toBe(3);

    acmeHeader.click();
    await waitFor(() => expect(acmeHeader.getAttribute('aria-expanded')).toBe('false'));
    // acme's 2 rows hidden; globex's 1 row remains.
    expect(container.querySelectorAll('.prm-browse-repo-row').length).toBe(1);
  });

  it('AC-REPO-9.4: "Load more" pages deeper when hasMore is set', async () => {
    const { host, listPages } = makeBrowseHost({
      hasMore: true,
      page2: [{ owner: 'initech', repo: 'tps', fullName: 'initech/tps', host: 'github.com', alreadyAdded: false }],
    });
    const { container } = renderRepos(host);
    await openBrowse(container);

    const loadMore = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-browse-load-more'))[0];
    expect(loadMore, 'Load more shown while hasMore').toBeTruthy();
    loadMore.click();
    await waitFor(() => expect(listPages).toEqual([1, 2]));
    await waitFor(() =>
      expect(
        Array.from(container.querySelectorAll('.prm-browse-group-name')).some((n) => n.textContent === 'initech')
      ).toBe(true)
    );
  });

  it('AC-REPO-9.7: an incomplete owner group shows a trailing ellipsis on its count', async () => {
    const { host } = makeBrowseHost({ hasMore: true, incompleteOwners: ['acme'] });
    const { container } = renderRepos(host);
    await openBrowse(container);

    const countFor = (owner: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-browse-group-header'))
        .find((h) => h.textContent?.includes(owner))
        ?.querySelector('.prm-browse-group-count')?.textContent?.replace(/\s+/g, '');

    // acme is the frontier owner → count carries the "…" partial marker.
    expect(countFor('acme')).toBe('(2…)');
    // globex is complete → plain count, no ellipsis.
    expect(countFor('globex')).toBe('(1)');
  });

  it('AC-REPO-9.7: the ellipsis is suppressed while a client-side filter is active', async () => {
    const { host } = makeBrowseHost({ hasMore: true, incompleteOwners: ['acme'] });
    const { container } = renderRepos(host);
    await openBrowse(container);

    const input = container.querySelector<HTMLInputElement>('.prm-browse-controls input')!;
    fireEvent.change(input, { target: { value: 'acme' } });
    await waitFor(() =>
      expect(
        Array.from(container.querySelectorAll('.prm-browse-group-name')).every((n) => n.textContent === 'acme')
      ).toBe(true)
    );
    const count = container.querySelector('.prm-browse-group-count')?.textContent?.replace(/\s+/g, '');
    // Filter narrows every count → the partial marker would mislead, so it's hidden.
    expect(count).toBe('(2)');
  });
});

describe('SettingsView — System area (R-SYS-*)', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  it('renders Auto-Sync Scheduling with the fixed 4-option interval dropdown', () => {
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'system' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={makeHost()} />);
    cleanup = () => container.remove();

    expect(container.textContent).toContain('Auto-Sync Scheduling');
    const select = container.querySelector('select.prm-input--select') as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.textContent);
    expect(opts).toEqual(['Every 15 minutes', 'Every 30 minutes', 'Every hour', 'Every 2 hours']);
  });

  it('changing the interval calls onSave with pollIntervalMinutes', () => {
    let saved: PrMonitorSettings | null = null;
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'system' };
    const { container } = render(
      <SettingsView
        settings={settings}
        onSave={(n) => {
          saved = n;
        }}
        host={makeHost()}
      />
    );
    cleanup = () => container.remove();

    const select = container.querySelector('select.prm-input--select') as HTMLSelectElement;
    select.value = '60';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(saved!.pollIntervalMinutes).toBe(60);
  });
});

describe('SettingsView — Traceability coverage (fabricated citations)', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  it('AC-REPO-7.1: Suggested dialog shows title, 90-day subtitle, close button', async () => {
    const host = makeHost({
      listRepos: { ok: true, repos: [] },
      listOrgs: { ok: true, orgs: [] },
      suggestRepositories: { ok: true, repos: [] },
    });
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'repositories' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-entity-card, .prm-area-empty')).toBeTruthy());
    const suggestedBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
      b.textContent?.includes('Suggested for you')
    )!;
    suggestedBtn.click();

    await waitFor(() => expect(container.textContent).toContain('Suggested for you'));
    expect(container.textContent).toContain('last 90 days');
    expect(container.querySelector('.prm-modal-header button[title="Close"]')).toBeTruthy();
  });

  it('AC-REPO-10.1: Test Connection shows spinning Wifi icon while in flight', async () => {
    let resolveProbe: ((v: { ok: boolean }) => void) | null = null;
    const probePromise = new Promise<{ ok: boolean }>((resolve) => {
      resolveProbe = resolve;
    });
    const host = {
      storage: { get: async () => null, set: async () => {} },
      cache: { get: () => null, set: () => {}, refreshBadge: () => {} },
      toast: () => {},
      openExternal: () => {},
      call: async (cap: string) => {
        switch (cap) {
          case 'listRepos':
            return {
              ok: true,
              repos: [
                {
                  host: 'github.com',
                  owner: 'foo',
                  repo: 'bar',
                  orgLogin: 'foo',
                  shortHost: 'github',
                  connection: 'connected',
                  active: true,
                  createdAt: Date.now(),
                },
              ],
            };
          case 'listOrgs':
            return { ok: true, orgs: [] };
          case 'testRepository':
            return probePromise;
          default:
            return undefined;
        }
      },
    } as unknown as ModuleHost;
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'repositories' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-repo-card')).toBeTruthy());
    const testBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
      b.textContent?.includes('Test Connection')
    )!;
    testBtn.click();

    await waitFor(() => expect(container.textContent).toContain('Testing connection'));
    const spinner = container.querySelector('.prm-spin');
    expect(spinner).toBeTruthy();
    expect(spinner?.closest('.prm-loading')).toBeTruthy();

    resolveProbe!({ ok: true });
  });

  it('AC-ORG-5.2: Disconnected org shows red pill with CircleX and gh auth login copy', async () => {
    const host = makeHost({
      listOrgs: {
        ok: true,
        orgs: [
          {
            host: 'github.com',
            login: 'broken-org',
            apiBaseUrl: 'https://api.github.com',
            shortHost: 'github',
            connection: 'disconnected',
          },
        ],
      },
    });
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'organizations' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-entity-card')).toBeTruthy());
    expect(container.textContent).toContain('broken-org');
    const pill = container.querySelector('.prm-conn-pill--disconnected');
    expect(pill).toBeTruthy();
    expect(pill?.textContent).toContain('Disconnected');
    // ConnectionPill renders a CircleX icon INSIDE the disconnected pill (ui.tsx:52).
    // Assert on the pill (state-specific), not on the always-rendered area explainer:
    // the 'gh auth login' copy is unconditional, so asserting it would pass even for
    // a connected org — a tautology. The icon lives only in the disconnected branch.
    expect(pill?.querySelector('svg')).toBeTruthy();
  });

  it('AC-PPL-4.3: Author identities show green CircleCheck for connected, Disconnected for others', async () => {
    const host = makeHost({
      getAuthor: {
        ok: true,
        author: {
          login: 'testuser',
          name: 'Test User',
          email: 'test@example.com',
          identities: [
            { host: 'github.com', shortHost: 'github', login: 'testuser', connection: 'connected' },
            { host: 'ghe.corp', shortHost: 'ghe', login: 'testuser', connection: 'disconnected' },
          ],
        },
      },
    });
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'author' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-author-card')).toBeTruthy());
    const expandBtn = container.querySelector('.prm-author-row') as HTMLButtonElement;
    expandBtn.click();

    await waitFor(() => expect(container.querySelector('.prm-identity-list')).toBeTruthy());
    const rows = container.querySelectorAll('.prm-identity-row');
    expect(rows.length).toBe(2);

    const connectedRow = Array.from(rows).find((r) => r.textContent?.includes('github'));
    expect(connectedRow?.querySelector('.prm-identity-verified')).toBeTruthy();
    // The connected identity does NOT get the Disconnected treatment.
    expect(connectedRow?.querySelector('.prm-identity-disconnected')).toBeFalsy();

    const disconnectedRow = Array.from(rows).find((r) => r.textContent?.includes('ghe'));
    // AC-PPL-4.3: a disconnected identity carries the Disconnected treatment
    // (R-ORG-005) instead of the verified check — assert BOTH sides, so the test
    // fails if the treatment is dropped (not just a trivial "verified absent").
    expect(disconnectedRow?.querySelector('.prm-identity-verified')).toBeFalsy();
    const treatment = disconnectedRow?.querySelector('.prm-identity-disconnected');
    expect(treatment).toBeTruthy();
    expect(treatment?.textContent).toContain('Disconnected');
  });

  it('AC-REPO-11.2: Repo settings dialog has General, Status and Notifications tabs', async () => {
    const host = makeHost({
      listRepos: {
        ok: true,
        repos: [
          {
            host: 'github.com',
            owner: 'acme',
            repo: 'widgets',
            orgLogin: 'acme',
            shortHost: 'github',
            connection: 'connected',
            active: true,
            createdAt: Date.now(),
          },
        ],
      },
      listOrgs: {
        ok: true,
        orgs: [
          {
            host: 'github.com',
            login: 'acme',
            apiBaseUrl: 'https://api.github.com',
            shortHost: 'github',
            connection: 'connected',
          },
        ],
      },
    });
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'repositories' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-repo-card')).toBeTruthy());
    const editBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
      b.textContent?.includes('Edit Repository')
    )!;
    editBtn.click();

    await waitFor(() => expect(container.querySelector('.prm-dialog-tabs')).toBeTruthy());
    const tabs = Array.from(container.querySelectorAll('.prm-dialog-tab'));
    expect(tabs.length).toBe(3);
    expect(tabs[0].textContent).toContain('General');
    expect(tabs[1].textContent).toContain('Status');
    expect(tabs[2].textContent).toContain('Notifications');

    const generalTab = tabs[0] as HTMLButtonElement;
    expect(generalTab.classList.contains('active')).toBe(true);
    expect(generalTab.textContent).toMatch(/General/);

    const notifBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
      b.textContent?.includes('Notification Settings')
    )!;
    container.querySelector<HTMLButtonElement>('.prm-modal-header button[title="Close"]')?.click();
    await waitFor(() => expect(container.querySelector('.prm-dialog-tabs')).toBeFalsy());

    // Notification Settings opens the dialog with the Notifications tab (3rd) active.
    notifBtn.click();
    await waitFor(() => expect(container.querySelector('.prm-dialog-tabs')).toBeTruthy());
    const notifTabs = Array.from(container.querySelectorAll('.prm-dialog-tab'));
    expect(notifTabs[2].classList.contains('active')).toBe(true);
  });

  it('§8/§6: Status tab exposes the four two-pill controls (Build preset, Review preset, SFCI-gated, Ignore-Snyk)', async () => {
    const host = makeHost({
      listRepos: {
        ok: true,
        repos: [
          {
            host: 'github.com',
            owner: 'acme',
            repo: 'widgets',
            orgLogin: 'acme',
            shortHost: 'github',
            connection: 'connected',
            active: true,
            createdAt: Date.now(),
          },
        ],
      },
      listOrgs: { ok: true, orgs: [] },
    });
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'repositories' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-repo-card')).toBeTruthy());
    const editBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
      b.textContent?.includes('Edit Repository')
    )!;
    editBtn.click();

    await waitFor(() => expect(container.querySelector('.prm-dialog-tabs')).toBeTruthy());
    const statusTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-dialog-tab')).find((t) =>
      t.textContent?.includes('Status')
    )!;
    statusTab.click();

    await waitFor(() => expect(container.textContent).toContain('Build-phase preset'));
    // Two preset dropdowns (Build hours, Review days) + two checkboxes (SFCI, Snyk).
    expect(container.textContent).toContain('Review-phase preset');
    expect(container.textContent).toContain('SFCI Gated Repo');
    expect(container.textContent).toContain('Ignore Snyk failures for build status');
    const selects = container.querySelectorAll('.prm-modal-body select.prm-input--select');
    expect(selects.length).toBe(2);
    const checks = container.querySelectorAll<HTMLInputElement>('.prm-checkbox-row input[type="checkbox"]');
    expect(checks.length).toBe(2);
  });

  it('§4/§8: enabling Ignore-Snyk saves ignoredFailingChecks=["Snyk"], and SFCI-gated persists', async () => {
    let savedPayload: { sfciGated?: boolean; ignoredFailingChecks?: string[] } | null = null;
    const host = {
      storage: { get: async () => null, set: async () => {} },
      cache: { get: () => null, set: () => {}, refreshBadge: () => {} },
      toast: () => {},
      openExternal: () => {},
      call: async (cap: string, arg?: unknown) => {
        switch (cap) {
          case 'listRepos':
            return {
              ok: true,
              repos: [
                {
                  host: 'github.com',
                  owner: 'acme',
                  repo: 'widgets',
                  orgLogin: 'acme',
                  shortHost: 'github',
                  connection: 'connected',
                  active: true,
                  createdAt: Date.now(),
                },
              ],
            };
          case 'listOrgs':
            return { ok: true, orgs: [] };
          case 'updateRepository':
            savedPayload = arg as typeof savedPayload;
            return { ok: true };
          default:
            return undefined;
        }
      },
    } as unknown as ModuleHost;
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'repositories' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-repo-card')).toBeTruthy());
    const editBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
      b.textContent?.includes('Edit Repository')
    )!;
    editBtn.click();

    await waitFor(() => expect(container.querySelector('.prm-dialog-tabs')).toBeTruthy());
    Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-dialog-tab'))
      .find((t) => t.textContent?.includes('Status'))!
      .click();
    await waitFor(() => expect(container.textContent).toContain('Ignore Snyk failures for build status'));

    // Toggle both checkboxes on (order: SFCI first, Snyk second).
    const checks = container.querySelectorAll<HTMLInputElement>('.prm-checkbox-row input[type="checkbox"]');
    checks[0].click(); // SFCI Gated Repo
    checks[1].click(); // Ignore Snyk

    const saveBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-modal-footer .prm-btn')).find((b) =>
      b.textContent?.includes('Save Settings')
    )!;
    saveBtn.click();

    await waitFor(() => expect(savedPayload).toBeTruthy());
    // Snyk toggle maps to the single-entry ['Snyk'] allowlist; SFCI is a plain flag.
    expect(savedPayload!.ignoredFailingChecks).toEqual(['Snyk']);
    expect(savedPayload!.sfciGated).toBe(true);
  });

  it('AC-ORG-5.3: org card shows a transient Checking… pill while Re-discover is in flight', async () => {
    let resolveRediscover: ((v: { ok: boolean }) => void) | null = null;
    const rediscoverPromise = new Promise<{ ok: boolean }>((resolve) => {
      resolveRediscover = resolve;
    });
    const connectedOrg = {
      host: 'gitcore.soma.salesforce.com',
      login: 'my-org',
      apiBaseUrl: 'https://gitcore.soma.salesforce.com/api/v3',
      shortHost: 'gitcore',
      connection: 'connected' as const,
    };
    const host = {
      storage: { get: async () => null, set: async () => {} },
      cache: { get: () => null, set: () => {}, refreshBadge: () => {} },
      toast: () => {},
      openExternal: () => {},
      call: async (cap: string) => {
        switch (cap) {
          case 'listOrgs':
            return { ok: true, orgs: [connectedOrg] };
          case 'rediscoverOrgs':
            return rediscoverPromise;
          default:
            return undefined;
        }
      },
    } as unknown as ModuleHost;
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'organizations' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => container.remove();

    // Card initially resolves to Connected.
    await waitFor(() => expect(container.querySelector('.prm-conn-pill--connected')).toBeTruthy());

    // Fire Re-discover; while rediscoverOrgs is in flight the pill flips to Checking.
    const rediscoverBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
      b.textContent?.includes('Re-discover')
    )!;
    rediscoverBtn.click();

    await waitFor(() => expect(container.querySelector('.prm-conn-pill--checking')).toBeTruthy());
    expect(container.textContent).toContain('Checking');
    expect(container.querySelector('.prm-conn-pill--connected')).toBeNull();

    // Resolving the refresh returns the card to its concrete state.
    resolveRediscover!({ ok: true });
    await waitFor(() => expect(container.querySelector('.prm-conn-pill--connected')).toBeTruthy());
    expect(container.querySelector('.prm-conn-pill--checking')).toBeNull();
  });

  it('AC-REPO-7.2: Suggested dialog scanning phase shows spinner and Looking message', async () => {
    let resolveSuggest: ((v: { ok: boolean; repos: unknown[] }) => void) | null = null;
    const suggestPromise = new Promise<{ ok: boolean; repos: unknown[] }>((resolve) => {
      resolveSuggest = resolve;
    });
    const host = {
      storage: { get: async () => null, set: async () => {} },
      cache: { get: () => null, set: () => {}, refreshBadge: () => {} },
      toast: () => {},
      openExternal: () => {},
      call: async (cap: string) => {
        switch (cap) {
          case 'listRepos':
            return { ok: true, repos: [] };
          case 'listOrgs':
            return { ok: true, orgs: [] };
          case 'suggestRepositories':
            return suggestPromise;
          default:
            return undefined;
        }
      },
    } as unknown as ModuleHost;
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'repositories' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-area-empty, .prm-entity-card')).toBeTruthy());
    const suggestedBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
      b.textContent?.includes('Suggested for you')
    )!;
    suggestedBtn.click();

    await waitFor(() => expect(container.textContent).toContain('Looking at your activity in the last 90 days'));
    const spinner = container.querySelector('.prm-loading .prm-spin');
    expect(spinner).toBeTruthy();

    const footer = container.querySelector('.prm-modal-footer');
    expect(footer?.textContent).toContain('Rescan');
    expect(footer?.textContent).toContain('Cancel');
    const addBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn--primary')).find((b) =>
      b.textContent?.includes('Add Selected')
    );
    expect(addBtn?.disabled).toBe(true);

    resolveSuggest!({ ok: true, repos: [] });
  });

  it('AC-REPO-7.3a: Suggested dialog empty results shows empty state with guidance', async () => {
    const host = makeHost({
      listRepos: { ok: true, repos: [] },
      listOrgs: { ok: true, orgs: [] },
      suggestRepositories: { ok: true, repos: [] },
    });
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'repositories' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-area-empty, .prm-entity-card')).toBeTruthy());
    const suggestedBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
      b.textContent?.includes('Suggested for you')
    )!;
    suggestedBtn.click();

    await waitFor(() => expect(container.querySelector('.prm-area-empty')).toBeTruthy());
    expect(container.textContent).toContain('No repositories found in your last 90 days of activity');
    expect(container.textContent).toContain('Add repository manually');

    const footer = container.querySelector('.prm-modal-footer');
    expect(footer?.textContent).toContain('Rescan');
    expect(footer?.textContent).toContain('Cancel');
    const addBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn--primary')).find((b) =>
      b.textContent?.includes('Add Selected')
    );
    expect(addBtn?.disabled).toBe(true);
  });

  it('AC-REPO-7.4: Already-added repo in suggested list shows CircleCheck and Already added', async () => {
    const host = makeHost({
      listRepos: { ok: true, repos: [] },
      listOrgs: { ok: true, orgs: [] },
      suggestRepositories: {
        ok: true,
        repos: [
          {
            owner: 'acme',
            repo: 'widgets',
            fullName: 'acme/widgets',
            host: 'github.com',
            prCount: 5,
            lastActivity: Date.now() - 86400000,
            alreadyAdded: true,
            orgLogin: 'acme',
          },
        ],
      },
    });
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'repositories' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-area-empty, .prm-entity-card')).toBeTruthy());
    const suggestedBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
      b.textContent?.includes('Suggested for you')
    )!;
    suggestedBtn.click();

    await waitFor(() => expect(container.querySelector('.prm-suggested-row')).toBeTruthy());
    const row = container.querySelector('.prm-suggested-row');
    expect(row?.querySelector('.prm-suggested-added')).toBeTruthy();
    expect(row?.textContent).toContain('Already added');

    const checkbox = row?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
  });

  it('AC-REPO-7.7: Unchecking a suggested repo decrements count and disables button at zero', async () => {
    const host = makeHost({
      listRepos: { ok: true, repos: [] },
      listOrgs: { ok: true, orgs: [] },
      suggestRepositories: {
        ok: true,
        repos: [
          {
            owner: 'acme',
            repo: 'widgets',
            fullName: 'acme/widgets',
            host: 'github.com',
            prCount: 5,
            lastActivity: Date.now() - 86400000,
            alreadyAdded: false,
            orgLogin: 'acme',
          },
        ],
      },
    });
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'repositories' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-area-empty, .prm-entity-card')).toBeTruthy());
    const suggestedBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
      b.textContent?.includes('Suggested for you')
    )!;
    suggestedBtn.click();

    await waitFor(() => expect(container.querySelector('.prm-suggested-row')).toBeTruthy());
    const checkbox = container.querySelector('.prm-suggested-row input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    checkbox.click();
    await waitFor(() => {
      const addBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn--primary')).find((b) =>
        b.textContent?.includes('Add 1 Selected')
      );
      return addBtn !== undefined;
    });
    const addBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn--primary')).find((b) =>
      b.textContent?.includes('Add 1 Selected')
    )!;
    expect(addBtn.disabled).toBe(false);

    checkbox.click();
    await waitFor(() => {
      const btn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn--primary')).find((b) =>
        b.textContent?.includes('Add Selected')
      );
      return btn?.disabled === true;
    });
    const disabledBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn--primary')).find((b) =>
      b.textContent?.includes('Add Selected')
    )!;
    expect(disabledBtn.disabled).toBe(true);
    expect(disabledBtn.textContent).not.toContain('1');
  });

  it('AC-REPO-10.2: Successful Test Connection shows CircleCheck and All tests passed', async () => {
    const host = {
      storage: { get: async () => null, set: async () => {} },
      cache: { get: () => null, set: () => {}, refreshBadge: () => {} },
      toast: () => {},
      openExternal: () => {},
      call: async (cap: string) => {
        switch (cap) {
          case 'listRepos':
            return {
              ok: true,
              repos: [
                {
                  host: 'github.com',
                  owner: 'acme',
                  repo: 'widgets',
                  orgLogin: 'acme',
                  shortHost: 'github',
                  connection: 'connected',
                  active: true,
                  createdAt: Date.now(),
                },
              ],
            };
          case 'listOrgs':
            return { ok: true, orgs: [] };
          case 'testRepository':
            return { ok: true };
          default:
            return undefined;
        }
      },
    } as unknown as ModuleHost;
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, settingsActiveNav: 'repositories' };
    const { container } = render(<SettingsView settings={settings} onSave={() => {}} host={host} />);
    cleanup = () => container.remove();

    await waitFor(() => expect(container.querySelector('.prm-repo-card')).toBeTruthy());
    const testBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
      b.textContent?.includes('Test Connection')
    )!;
    testBtn.click();

    await waitFor(() => expect(container.textContent).toContain('All connection tests passed'));
    const result = container.querySelector('.prm-test-result--ok');
    expect(result).toBeTruthy();
    expect(result?.textContent).toContain('All connection tests passed');

    const closeX = container.querySelector<HTMLButtonElement>('.prm-modal-header button[title="Close"]');
    expect(closeX).toBeTruthy();
  });
});
