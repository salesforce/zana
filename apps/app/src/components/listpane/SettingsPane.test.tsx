// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  dismiss: null as (() => void) | null,
  pluginList: vi.fn(async () => []),
  ui: {
    settingsTab: 'global',
    setSettingsAnchor: vi.fn(),
    selectedProjectId: 'selected' as string | null,
    focusedProjectId: null as string | null,
    settingsAnchor: null as string | null
  },
  data: { projects: [{ id: 'selected', name: 'Demo' }] },
  snapshot: { config: { theme: 'Dark' } } as never,
  snapshotEnabled: [] as boolean[]
}));

vi.mock('../../store.js', () => ({
  useUi: (select: (state: typeof h.ui) => unknown) => select(h.ui),
  // Same shape as the zustand store: runtime providers read and subscribe to it.
  useData: Object.assign((select: (state: typeof h.data) => unknown) => select(h.data), {
    getState: () => ({ ...h.data, harnessStatus: [] }),
    subscribe: () => () => {}
  })
}));
vi.mock('../../hooks/useAppSettingsRouteMemory.js', () => ({
  useAppSettingsRouteMemory: () => ({ appRoutePath: '/inbox' })
}));
vi.mock('../SidebarResizer.js', () => ({ SidebarResizer: () => null }));
vi.mock('../../lib/settings-search/snapshot.js', () => ({
  useSettingsSnapshot: (_projectId: string | null, enabled: boolean) => {
    h.snapshotEnabled.push(enabled);
    return h.snapshot;
  }
}));
vi.mock('../mobile-nav-context.js', () => ({ useMobileNavDismiss: () => h.dismiss }));
vi.mock('../../lib/product-client.js', () => ({
  product: { pluginApps: { list: h.pluginList, getSettings: async () => ({ descriptors: {}, values: {} }) } }
}));

import { SettingsPane, groupHitsByPage, shouldAutofocusSettingsSearch } from './SettingsPane.js';
import { ensureSettingsSearchProviders } from '../../lib/settings-search/runtime.js';
import type { SettingsSearchHit } from '../../lib/settings-search/index.js';

function Location() {
  const l = useLocation();
  return <div data-testid="location">{l.pathname}</div>;
}

function Hash() {
  return <div data-testid="hash">{useLocation().hash}</div>;
}

function mount() {
  return render(<MemoryRouter initialEntries={['/settings/global']}><SettingsPane /><Location /><Hash /></MemoryRouter>);
}

beforeEach(() => {
  h.dismiss = null;
  h.ui.settingsTab = 'global';
  h.ui.selectedProjectId = 'selected';
  h.ui.focusedProjectId = null;
  h.peersVisible = false;
  h.ui.settingsAnchor = null;
  vi.clearAllMocks();
});
afterEach(async () => {
  cleanup();
  const runtime = ensureSettingsSearchProviders();
  await act(async () => { await runtime.prefetchPluginSettings(); });
  runtime.dispose();
});

describe('groupHitsByPage', () => {
  const hit = (id: string, section: string, tier: 1 | 2 | 3): SettingsSearchHit =>
    ({ entry: { id, section, label: id, kind: 'setting' }, breadcrumb: section, score: 1, tier }) as SettingsSearchHit;

  it('orders pages by their best hit, never by Settings order, so a typo page cannot outrank an exact one', () => {
    // Engine order: exact hits on Harness and Project first, then typo hits on Preferences.
    const pages = groupHitsByPage([hit('harness.model', 'harness', 1), hit('project.model', 'project', 1), hit('global.theme', 'global', 3)]);
    expect(pages.map((p) => p.section)).toEqual(['harness', 'project', 'global']);
    // The first row (the one Enter opens) is the top-ranked hit.
    expect(pages.flatMap((p) => p.hits)[0].entry.id).toBe('harness.model');
  });

  it('never lets a fuzzy row of an earlier page sit above an exact row of a later page', () => {
    // Engine order: exact harness, exact project, then a typo hit on harness.
    const engine = [hit('harness.a', 'harness', 1), hit('project.b', 'project', 1), hit('harness.c', 'harness', 3)];
    const pages = groupHitsByPage(engine);
    expect(pages.map((p) => [p.section, p.close])).toEqual([['harness', false], ['project', false], ['harness', true]]);
    // The flattened list (what arrows walk and Enter opens) is exactly the engine's order.
    expect(pages.flatMap((p) => p.hits).map((h) => h.entry.id)).toEqual(['harness.a', 'project.b', 'harness.c']);
    expect(new Set(pages.map((p) => p.key)).size).toBe(pages.length);
  });

  it('keeps rank order inside a page and band', () => {
    const pages = groupHitsByPage([hit('a', 'terminal', 1), hit('b', 'agents', 1), hit('c', 'terminal', 1), hit('d', 'terminal', 2)]);
    expect(pages[0].hits.map((h) => h.entry.id)).toEqual(['a', 'c']);
    expect(pages.at(-1)).toMatchObject({ section: 'terminal', close: true });
  });
});

describe('search focus on entering Settings', () => {
  const search = () => screen.getByRole('combobox', { name: 'Search settings' });

  it('focuses the search box when Settings opens, so typing goes straight into it', () => {
    mount();
    expect(document.activeElement).toBe(search());
    expect(h.pluginList).toHaveBeenCalledTimes(1);
    // Moving between sections keeps the rail mounted and never re-takes focus.
    fireEvent.click(screen.getByRole('link', { name: 'Terminal' }));
    const other = document.createElement('button');
    document.body.append(other);
    other.focus();
    fireEvent.click(screen.getByRole('link', { name: 'Preferences' }));
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('leaves focus to a deep link, which focuses its own field', () => {
    h.ui.settingsAnchor = 'global.appearance';
    mount();
    expect(document.activeElement).not.toBe(search());
  });

  it('does not pop the on-screen keyboard in the compact drawer', () => {
    h.dismiss = vi.fn();
    mount();
    expect(document.activeElement).not.toBe(search());
  });

  it('keeps focus in a modal dialog or the Settings page itself', () => {
    const at = (html: string) => {
      const host = document.createElement('div');
      host.innerHTML = html;
      document.body.append(host);
      const el = host.querySelector('[data-target]')!;
      const result = shouldAutofocusSettingsSearch({ anchor: null, compact: false, active: el });
      host.remove();
      return result;
    };
    expect(at('<div role="dialog" aria-modal="true"><button data-target></button></div>')).toBe(false);
    expect(at('<dialog open><button data-target></button></dialog>')).toBe(false);
    expect(at('<div class="settings-panel settings-panel--preferences"><input data-target></div>')).toBe(false);
    // Plain .settings-panel is shared with Home, Scheduler and Extensions: Ctrl+,
    // from those pages must still focus search.
    expect(at('<div class="settings-panel home-panel"><textarea data-target></textarea></div>')).toBe(true);
    expect(at('<div role="dialog"><textarea data-target></textarea></div>')).toBe(true); // non-modal
    expect(at('<textarea data-target></textarea>')).toBe(true); // e.g. the hidden terminal
    expect(shouldAutofocusSettingsSearch({ anchor: null, compact: false, active: null })).toBe(true);
    expect(shouldAutofocusSettingsSearch({ anchor: 'x', compact: false, active: null })).toBe(false);
    expect(shouldAutofocusSettingsSearch({ anchor: null, compact: true, active: null })).toBe(false);
  });
});

describe('focused Settings navigation', () => {
  it('reads current values only while the box is focused or has a query', () => {
    mount();
    const search = screen.getByRole('combobox', { name: 'Search settings' });
    const last = () => h.snapshotEnabled.at(-1);
    expect(last()).toBe(true); // focused on entry
    fireEvent.blur(search);
    expect(last()).toBe(false);
    fireEvent.focus(search);
    expect(last()).toBe(true);
    fireEvent.blur(search);
    expect(last()).toBe(false); // empty box: stop reading values
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: 'theme' } });
    fireEvent.blur(search);
    expect(last()).toBe(true); // a live query keeps its values current
  });

  it('dismisses the mobile drawer even when the selected section or anchor keeps the same route', () => {
    h.dismiss = vi.fn();
    mount();
    fireEvent.click(screen.getByRole('link', { name: 'Preferences' }));
    expect(h.dismiss).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('combobox', { name: 'Search settings' }), { target: { value: 'appearance' } });
    fireEvent.click(screen.getByTestId('settings-result-global.appearance'));
    expect(h.dismiss).toHaveBeenCalledTimes(2);
    expect(h.ui.setSettingsAnchor).toHaveBeenLastCalledWith('global.appearance');
    fireEvent.click(screen.getByRole('link', { name: 'Back to app' }));
    expect(h.dismiss).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('location').textContent).toBe('/inbox');
  });
  it('announces the current page, keeps other sections reachable, and returns to the prior app route', () => {
    mount();
    expect(screen.getByRole('link', { name: 'Preferences' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Terminal' }).hasAttribute('aria-current')).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: 'Terminal' }));
    expect(screen.getByTestId('location').textContent).toBe('/settings/terminal');
    expect(h.ui.setSettingsAnchor).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole('link', { name: 'Back to app' }));
    expect(screen.getByTestId('location').textContent).toBe('/inbox');
  });

  it('renders ranked, grouped results with breadcrumb and highlighted snippet, and routes by entry id', () => {
    mount();
    const search = screen.getByRole('combobox', { name: 'Search settings' });
    fireEvent.change(search, { target: { value: 'heartbeat' } });
    expect(screen.queryByRole('link', { name: 'Terminal' })).toBeNull();
    const list = screen.getByRole('listbox');
    expect(list).toBeTruthy();
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(search.getAttribute('aria-activedescendant')).toBe(options[0].id);
    expect(screen.getByRole('group', { name: 'Agents' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('settings-result-agents.agent-heartbeat.intro'));
    expect(screen.getByTestId('location').textContent).toBe('/settings/agents');
    // Cross-page jump: the target travels in the URL hash, not only in memory.
    expect(screen.getByTestId('hash').textContent).toBe('#agents.agent-heartbeat.intro');
    expect(h.ui.setSettingsAnchor).toHaveBeenLastCalledWith('agents.agent-heartbeat.intro');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('link', { name: 'Terminal' })).toBeTruthy();
  });

  it('supports ArrowDown/ArrowUp/Enter and opens a section result without a hash', () => {
    mount();
    const search = screen.getByRole('combobox', { name: 'Search settings' });
    fireEvent.change(search, { target: { value: 'terminal' } });
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(1);
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    // Results are grouped by page in section order: walk down to the Terminal page row.
    const target = options.indexOf(screen.getByTestId('settings-result-terminal.section'));
    for (let i = 0; i < target; i += 1) fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByTestId('location').textContent).toBe('/settings/terminal');
    expect(screen.getByTestId('hash').textContent).toBe('');
  });

  it('re-ranks an open query once lazily fetched sources arrive', async () => {
    const reg = await import('../../lib/settings-search/registry.js');
    mount();
    const search = screen.getByRole('combobox', { name: 'Search settings' });
    fireEvent.change(search, { target: { value: 'lazyquokka' } });
    expect(screen.getByText('No matching settings')).toBeTruthy();
    let landed: Array<{ id: string; section: string; label: string; kind: 'setting' }> = [];
    const off = reg.registerSettingsSearchProvider(() => landed);
    fireEvent.focus(search);
    // Same path as the plugin prefetch: data lands asynchronously, then signals.
    landed = [{ id: 'lazy.quokka', section: 'agents', label: 'Lazy quokka thing', kind: 'setting' }];
    act(() => reg.notifySettingsSearchSourcesChanged());
    expect(await screen.findByTestId('settings-result-lazy.quokka')).toBeTruthy();
    off();
  });

  it('scrolls the active option into view and ignores Enter during IME composition', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    mount();
    const search = screen.getByRole('combobox', { name: 'Search settings' });
    fireEvent.change(search, { target: { value: 'terminal' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    fireEvent.keyDown(search, { key: 'Enter', isComposing: true });
    expect(screen.getByTestId('location').textContent).not.toBe('/settings/terminal');
  });

  it('highlights snippet hits with <mark>, shows Current values, and routes project entries via project context', async () => {
    const reg = await import('../../lib/settings-search/registry.js');
    const off = reg.registerSettingsSearchProvider(() => [
      { id: 'rt.child', section: 'project', label: 'Child toggle', help: 'Needs the zebra flag here.', kind: 'setting', dependsOn: 'rt.parent', value: () => 'Dark' },
      { id: 'rt.parent', section: 'agents', label: 'Parent switch', kind: 'setting' }
    ]);
    h.ui.focusedProjectId = 'focused';
    mount();
    const search = screen.getByRole('combobox', { name: 'Search settings' });
    fireEvent.change(search, { target: { value: 'zebra' } });
    const row = screen.getByTestId('settings-result-rt.child');
    expect(row.querySelector('mark')?.textContent).toBe('zebra');
    expect(row.textContent).toContain('Appears when Parent switch is on');
    fireEvent.click(row);
    expect(screen.getByTestId('location').textContent).toBe('/projects/focused/settings');
    expect(screen.getByTestId('hash').textContent).toBe('#rt.child');
    fireEvent.change(search, { target: { value: 'dark' } });
    expect(screen.getByTestId('settings-result-rt.child').textContent).toContain('Current: Dark');
    off();
  });

  it('announces empty results and lets Escape clear the search without leaving Settings', () => {
    mount();
    const search = screen.getByRole('combobox', { name: 'Search settings' });
    fireEvent.change(search, { target: { value: 'no matching preference xyz' } });
    expect(screen.getByRole('status').textContent).toBe('No matching settings');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('status')).toBeNull();
    expect((search as HTMLInputElement).value).toBe('');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.getByTestId('location').textContent).toBe('/settings/global');
  });

  it('resolves Project settings from focused, selected, and absent project context', () => {
    h.ui.focusedProjectId = 'focused';
    const first = mount();
    expect(screen.getByRole('link', { name: 'Project settings' }).getAttribute('href')).toBe('/projects/focused/settings');
    first.unmount();
    h.ui.focusedProjectId = null;
    const second = mount();
    expect(screen.getByRole('link', { name: 'Project settings' }).getAttribute('href')).toBe('/projects/selected/settings');
    second.unmount();
    h.ui.selectedProjectId = null;
    mount();
    expect(screen.getByRole('link', { name: 'Project settings' }).getAttribute('href')).toBe('/settings/project');
  });
});

describe('SettingsPane Peers navigation', () => {
  it('always shows the Peers row', () => {
    mount();
    expect(screen.getByTestId('settings-nav-peers')).toBeTruthy();
    expect(screen.getByTestId('settings-nav-machines')).toBeTruthy();
  });
});
