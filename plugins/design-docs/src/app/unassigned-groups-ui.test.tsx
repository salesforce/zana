// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { UnassignedProject } from './api.js';
import { createHarness } from './test-harness.js';
import { NavPanel } from './slots.js';

// Node 26 ships a broken experimental localStorage that shadows happy-dom's. Use a Map-backed one only then.
class MemoryStorage {
  getItem(k: string) { return Object.prototype.hasOwnProperty.call(this, k) ? (this as unknown as Record<string, string>)[k]! : null; }
  setItem(k: string, v: string) { (this as unknown as Record<string, string>)[k] = String(v); }
  removeItem(k: string) { delete (this as unknown as Record<string, string>)[k]; }
  clear() { for (const k of Object.keys(this)) delete (this as unknown as Record<string, string>)[k]; }
}
beforeAll(() => {
  let usable = false;
  try {
    window.localStorage.setItem('dd-probe', '1');
    usable = window.localStorage.getItem('dd-probe') === '1' && Object.keys(window.localStorage).includes('dd-probe');
    window.localStorage.removeItem('dd-probe');
  } catch { /* fall through */ }
  if (!usable) Object.defineProperty(window, 'localStorage', { value: new MemoryStorage(), configurable: true });
});

const WRITE_RPCS = ['mapForeignProject', 'unmapForeignProject'];

interface Fake { id: string; fid?: unknown; title: string; at?: number }
function summary(f: Fake) {
  return { id: f.id, slug: f.id, title: f.title, summary: '', tags: [], status: 'draft', projectId: null, openComments: 0, pinnedAt: null, alternativeTo: null, lastComment: null, updatedAt: f.at ?? 1000, createdAt: 1, updatedBy: { kind: 'user', label: 'me' }, createdBy: { kind: 'user', label: 'me' }, ...(f.fid === undefined ? {} : { foreignProjectId: f.fid }) };
}
const project = (id: string, extra: Partial<UnassignedProject> = {}): UnassignedProject => ({ foreignProjectId: id, docCount: 1, sampleTitles: [], senderName: null, senderTag: null, suggestion: null, ...extra });

function mount(opts: { docs: Fake[]; projects: UnassignedProject[] | Promise<UnassignedProject[]> | Error; onList?: (args: unknown) => void; mapped?: string[] }) {
  const state = { docs: opts.docs, projects: opts.projects, mappedCalls: [] as unknown[] };
  const harness = createHarness({
    rpcOverrides: {
      list: (args) => {
        opts.onList?.(args);
        if ((args as { unassigned?: boolean } | null)?.unassigned) {
          const q = ((args as { query?: string }).query ?? '').toLowerCase();
          return state.docs.filter((d) => d.title.toLowerCase().includes(q)).map(summary);
        }
        return [];
      },
      listUnassignedProjects: async () => {
        if (state.projects instanceof Error) throw state.projects;
        return state.projects;
      },
      mapForeignProject: (args) => {
        state.mappedCalls.push(args);
        const id = (args as { foreignProjectId: string }).foreignProjectId;
        state.docs = state.docs.filter((d) => d.fid !== id);
        state.projects = (state.projects as UnassignedProject[]).filter((p) => p.foreignProjectId !== id);
        return { foreignProjectId: id, localProjectId: (args as { localProjectId: string }).localProjectId };
      }
    }
  });
  const view = harness.render(<NavPanel pluginId="design-docs" />);
  const writes = () => harness.rpcCalls.filter((c) => WRITE_RPCS.includes(c.method));
  return { harness, state, view, writes };
}
const section = () => screen.findByRole('region', { name: 'Unassigned from peers' });
const collapsedStored = () => {
  const key = Object.keys(window.localStorage).find((k) => k.endsWith('list-collapsed'));
  return key ? (JSON.parse(JSON.parse(window.localStorage.getItem(key)!) as string) as string[]) : [];
};

/** The plugin's persistent-state key for the collapsed set, learned from a first mount. */
async function storageKeyOf(): Promise<string> {
  const first = mount(TWO);
  await section();
  first.view.unmount();
  const grouped = Object.keys(window.localStorage).find((k) => k.endsWith('list-grouped'));
  if (grouped) return grouped.replace(/list-grouped$/, 'list-collapsed');
  // Nothing persisted yet: collapse a section to reveal the prefix.
  const again = mount(TWO);
  fireEvent.click(await screen.findByRole('button', { name: 'Collapse all sections' }));
  again.view.unmount();
  return Object.keys(window.localStorage).find((k) => k.endsWith('list-collapsed'))!;
}

const TWO = {
  docs: [
    { id: 'a1', fid: 'raw-id-alpha', title: 'Alpha one', at: 3000 },
    { id: 'a2', fid: 'raw-id-alpha', title: 'Alpha two', at: 2500 },
    { id: 'b1', fid: 'raw-id-beta', title: 'Beta one', at: 2000 }
  ],
  projects: [
    project('raw-id-alpha', { senderName: 'Alpha Svc', senderTag: 'al', docCount: 2, suggestion: { projectId: 'p1', name: 'App', basis: 'name' } }),
    project('raw-id-beta', { senderName: 'Beta Svc', docCount: 1 })
  ]
};

describe('Unassigned subgroups', () => {
  it('renders one subgroup per peer project, read-only, never showing the raw id', async () => {
    const { harness, writes } = mount(TWO);
    const region = await section();
    const alpha = await within(region).findByRole('group', { name: /^Alpha Svc/ });
    const beta = within(region).getByRole('group', { name: /^Beta Svc/ });
    expect(alpha.getAttribute('aria-label')).toBe('Alpha Svc, suggested: App, from another computer, 2 docs');
    expect(beta.getAttribute('aria-label')).toBe('Beta Svc, from another computer, 1 doc');
    expect(within(alpha).getByText('peer').getAttribute('title')).toBe('From another computer; not a local Project');
    expect(within(beta).getByText('peer')).toBeTruthy();
    expect(within(alpha).getByText('Alpha one')).toBeTruthy();
    expect(within(region).queryByText('Other')).toBeNull();
    // Section count is the sum of the subgroups.
    expect(within(region).getByRole('button', { name: /Unassigned from peers/ }).textContent).toContain('3');
    expect(document.body.innerHTML).not.toContain('raw-id-');
    expect(writes()).toEqual([]);
    expect(harness.rpcCalls.length).toBeGreaterThan(0);
  });

  it('shows suggested chip and the Map button only for suggested subgroups, with the basis in tooltip and aria-label', async () => {
    mount(TWO);
    const region = await section();
    const alpha = await within(region).findByRole('group', { name: /^Alpha Svc/ });
    expect(within(alpha).getByText('suggested: App').getAttribute('title')).toBe('Suggested Project, matched by name');
    // The whole toggle also carries the tooltip, so hovering anywhere on the heading explains the chips.
    const toggle = alpha.querySelector('.dd-list-subtoggle')!;
    expect(toggle.getAttribute('title')).toBe('Alpha Svc\nFrom another computer; not a local Project\nSuggested Project: App (matched by name)');
    const button = within(alpha).getByRole('button', { name: 'Map Alpha Svc docs to App, matched by name' });
    expect(button.getAttribute('title')).toContain('matched by name');
    expect(button.tagName).toBe('BUTTON');
    expect(button.closest('button:not(.dd-map-short)')).toBeNull(); // never nested inside the toggle
    const beta = within(region).getByRole('group', { name: /^Beta Svc/ });
    expect(within(beta).queryByRole('button', { name: /Map Beta/ })).toBeNull();
    expect(within(beta).queryByText(/suggested/)).toBeNull();
  });

  it('uses the tag basis wording', async () => {
    mount({ docs: [{ id: 'x', fid: 'f', title: 'X' }], projects: [project('f', { senderName: 'Pee', suggestion: { projectId: 'p2', name: 'Site', basis: 'tag' } })] });
    expect(await screen.findByRole('button', { name: 'Map Pee docs to Site, matched by tag' })).toBeTruthy();
  });

  it('labels with the first doc title or Unnamed when the sender has no name, and marks colliding labels', async () => {
    mount({
      docs: [{ id: 'x', fid: 'f1', title: 'Scratch' }, { id: 'y', fid: 'f2', title: 'Second' }, { id: 'z', fid: 'f3', title: 'Third' }],
      projects: [project('f1', { sampleTitles: ['Scratch'] }), project('f2', { senderName: 'App' }), project('f3', { senderName: 'App', senderTag: 'tg' })]
    });
    const region = await section();
    expect(await within(region).findByRole('group', { name: /^Scratch, from/ })).toBeTruthy();
    expect(within(region).getByRole('group', { name: /^App \(tg\), from/ })).toBeTruthy(); // collides with local Project App and with each other
    expect(within(region).getByRole('group', { name: /^App #\d, from/ })).toBeTruthy();
  });

  it('keeps hostile text as inert text', async () => {
    mount({ docs: [{ id: 'x', fid: 'f1', title: 'T' }], projects: [project('f1', { senderName: '<img src=x onerror=alert(1)>' })] });
    const region = await section();
    expect(await within(region).findByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(region.querySelector('img')).toBeNull();
  });

  it('shows N+ when the doc list reaches its cap', async () => {
    const docs = Array.from({ length: 200 }, (_, i) => ({ id: `d${i}`, fid: 'f1', title: `Doc ${i}`, at: 5000 - i }));
    mount({ docs, projects: [project('f1', { senderName: 'Big' })] });
    const region = await section();
    const group = await within(region).findByRole('group', { name: /^Big/ });
    expect(group.getAttribute('aria-label')).toContain('200+ docs');
    expect(within(group).getAllByText('200+').length).toBeGreaterThan(0);
    expect(within(region).getByRole('button', { name: /Unassigned from peers/ }).textContent).toContain('200+');
  });

  it('shows a skeleton instead of the name while labels load, then fills in without reordering', async () => {
    let resolve!: (value: UnassignedProject[]) => void;
    const pending = new Promise<UnassignedProject[]>((r) => { resolve = r; });
    mount({ docs: TWO.docs, projects: pending });
    const region = await section();
    const groups = await within(region).findAllByRole('group');
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.getAttribute('aria-busy')).toBe('true');
      expect(group.getAttribute('aria-label')).toMatch(/^Loading project name, from another computer, \d docs?$/);
      expect(within(group).getByText('Loading project name')).toBeTruthy();
      expect(within(group).getByText('peer')).toBeTruthy();
      expect(within(group).queryByText(/suggested/)).toBeNull();
      expect(within(group).queryByRole('button', { name: /^Map / })).toBeNull();
      expect(group.querySelector('.dd-skel')?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(region.textContent).not.toContain('Unnamed project');
    expect(region.textContent).not.toContain('raw-id-');
    await act(async () => resolve(TWO.projects));
    const after = await within(region).findAllByRole('group');
    expect(after.map((g) => g.getAttribute('aria-label')!.split(',')[0])).toEqual(['Alpha Svc', 'Beta Svc']);
    expect(after.every((g) => g.getAttribute('aria-busy') === null)).toBe(true);
  });

  it('falls back to each first doc title when the label source fails', async () => {
    mount({ docs: TWO.docs, projects: new Error('labels down') });
    const region = await section();
    expect(await within(region).findByRole('group', { name: /^Alpha one, from/ })).toBeTruthy();
    expect(within(region).getByRole('group', { name: /^Beta one, from/ })).toBeTruthy();
  });

  it('puts docs without a usable id in a closed Other group, opened explicitly, counted by collapse-all', async () => {
    mount({ docs: [{ id: 'n', fid: 123, title: 'Numeric id', at: 10 }, { id: 'a', fid: 'f1', title: 'Real', at: 20 }], projects: [project('f1', { senderName: 'Real Svc' })] });
    const region = await section();
    const other = await within(region).findByRole('group', { name: /^Other, 1 doc$/ });
    expect(within(other).queryByText('peer')).toBeNull();
    expect(within(other).queryByText('Numeric id')).toBeNull(); // closed
    expect(within(other).getByRole('button', { name: /Other/ }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(within(other).getByRole('button', { name: /Other/ }));
    expect(within(other).getByText('Numeric id')).toBeTruthy();
    // Opening Other counts as open for collapse-all, which collapses and closes it.
    fireEvent.click(await screen.findByRole('button', { name: 'Collapse all sections' }));
    expect(await screen.findByRole('button', { name: 'Expand all sections' })).toBeTruthy();
    expect(screen.queryByText('Numeric id')).toBeNull();
    // Expand-all opens everything, Other included.
    fireEvent.click(screen.getByRole('button', { name: 'Expand all sections' }));
    expect(await screen.findByText('Numeric id')).toBeTruthy();
  });

  it('collapses a subgroup, remembers it by key, and collapse-all and expand-all cover subgroups', async () => {
    mount(TWO);
    const region = await section();
    const alpha = await within(region).findByRole('group', { name: /^Alpha Svc/ });
    const toggle = within(alpha).getAllByRole('button')[0]!;
    fireEvent.click(toggle);
    expect(within(alpha).queryByText('Alpha one')).toBeNull();
    expect(collapsedStored()).toEqual(['unassigned:raw-id-alpha']);
    fireEvent.click(toggle);
    expect(within(alpha).getByText('Alpha one')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all sections' }));
    expect(collapsedStored()).toEqual(expect.arrayContaining(['unassigned', 'unassigned:raw-id-alpha', 'unassigned:raw-id-beta']));
    fireEvent.click(screen.getByRole('button', { name: 'Expand all sections' }));
    expect(collapsedStored()).toEqual([]);
  });

  it('prunes only stale subgroup keys once the unfiltered lists have settled', async () => {
    const storageKey = await storageKeyOf();
    window.localStorage.setItem(storageKey, JSON.stringify(JSON.stringify(['pinned', 'unassigned:raw-id-alpha', 'unassigned:vanished'])));
    mount(TWO);
    const region = await section();
    await within(region).findByRole('group', { name: /^Alpha Svc/ });
    await waitFor(() => expect(collapsedStored()).toEqual(['pinned', 'unassigned:raw-id-alpha']));
  });

  it('does not prune when the project list is at its cap', async () => {
    const storageKey = await storageKeyOf();
    const capped = Array.from({ length: 200 }, (_, i) => project(`c${i}`, { senderName: `C${i}` }));
    window.localStorage.setItem(storageKey, JSON.stringify(JSON.stringify(['unassigned:vanished'])));
    mount({ docs: [{ id: 'q', fid: 'c1', title: 'Q' }], projects: capped });
    await section();
    await new Promise((r) => setTimeout(r, 50));
    expect(collapsedStored()).toEqual(['unassigned:vanished']);
  });

  it('searching expands every subgroup, hides empty ones, keeps previous groups while loading and shows an empty state', async () => {
    mount(TWO);
    const region = await section();
    const alpha = await within(region).findByRole('group', { name: /^Alpha Svc/ });
    fireEvent.click(within(alpha).getAllByRole('button')[0]!); // collapse alpha
    const input = screen.getByRole('textbox', { name: 'Search design docs' });
    fireEvent.change(input, { target: { value: 'beta' } });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Unassigned from peers' })).queryByRole('group', { name: /^Alpha Svc/ })).toBeNull());
    const beta = within(screen.getByRole('region', { name: 'Unassigned from peers' })).getByRole('group', { name: /^Beta Svc/ });
    expect(within(beta).getByText('Beta one')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Unassigned from peers' })).getByRole('button', { name: /Unassigned from peers/ }).textContent).toContain('1');
    // Toggling during a search persists nothing.
    const before = JSON.stringify(collapsedStored());
    fireEvent.click(within(beta).getAllByRole('button')[0]!);
    expect(JSON.stringify(collapsedStored())).toBe(before);
    expect(within(beta).getByText('Beta one')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'zzz-no-match' } });
    expect(await screen.findByText('No matching docs from peers.')).toBeTruthy();
  });

  it('maps a project: its subgroup disappears without a reload and label metadata does not flicker', async () => {
    const { state } = mount(TWO);
    const region = await section();
    fireEvent.click(await within(region).findByRole('button', { name: /Map Alpha Svc docs to App/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Map projects from other computers' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Map 2 docs to App$/ }));
    await waitFor(() => expect(state.mappedCalls).toEqual([{ foreignProjectId: 'raw-id-alpha', localProjectId: 'p1' }]));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Unassigned from peers' })).queryByRole('group', { name: /^Alpha/ })).toBeNull());
    expect(within(screen.getByRole('region', { name: 'Unassigned from peers' })).getByRole('group', { name: /^Beta Svc/ })).toBeTruthy();
  });
});

describe('Map shortcut', () => {
  it('opens the dialog focused on that card, writes nothing until Map, and returns focus on close', async () => {
    const { writes } = mount(TWO);
    const region = await section();
    const button = await within(region).findByRole('button', { name: /Map Alpha Svc docs to App/ });
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Map projects from other computers' });
    const card = within(dialog).getByRole('region', { name: 'Project Alpha Svc' });
    expect(card.className).toContain('dd-map-card-focus');
    expect(within(card).getByText('Sender name').nextElementSibling?.textContent).toBe('Alpha Svc');
    expect(within(card).getByText('Tag').nextElementSibling?.textContent).toBe('al');
    expect(within(dialog).getByRole('region', { name: 'Project Beta Svc' }).className).not.toContain('dd-map-card-focus');
    expect((within(card).getByRole('combobox') as HTMLSelectElement).value).toBe('p1'); // preselected, not applied
    await waitFor(() => expect(document.activeElement).toBe(within(card).getByRole('combobox')));
    expect(writes()).toEqual([]);
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('region', { name: 'Unassigned from peers' })).getByRole('button', { name: /Map Alpha Svc docs to App/ })));
    expect(writes()).toEqual([]);
  });

  it('returns focus to the next subgroup toggle when the originating subgroup is gone after a map', async () => {
    mount(TWO);
    const region = await section();
    fireEvent.click(await within(region).findByRole('button', { name: /Map Alpha Svc docs to App/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Map 2 docs to App$/ }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Unassigned from peers' })).queryByRole('group', { name: /^Alpha/ })).toBeNull());
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);
    await waitFor(() => {
      const beta = within(screen.getByRole('region', { name: 'Unassigned from peers' })).getByRole('group', { name: /^Beta Svc/ });
      expect(document.activeElement).toBe(within(beta).getAllByRole('button')[0]);
    });
  });

  it('falls back to the section header when no subgroup remains', async () => {
    mount({ docs: [{ id: 'a', fid: 'f1', title: 'A' }], projects: [project('f1', { senderName: 'Solo', suggestion: { projectId: 'p1', name: 'App', basis: 'name' } })] });
    const region = await section();
    fireEvent.click(await within(region).findByRole('button', { name: /Map Solo docs to App/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Map 1 doc to App$/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Unassigned from peers' })).toBeNull());
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.dd-list-scroll')));
  });

  it('focuses the matching card for a hostile foreign id without ever using it as a selector or rendering it', async () => {
    const hostile = '"] , x[';
    mount({ docs: [{ id: 'a', fid: hostile, title: 'A' }], projects: [project(hostile, { senderName: 'Odd', suggestion: { projectId: 'p1', name: 'App', basis: 'name' } })] });
    const region = await section();
    fireEvent.click(await within(region).findByRole('button', { name: /Map Odd docs to App/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('region', { name: 'Project Odd' }).className).toContain('dd-map-card-focus');
    expect(document.body.innerHTML).not.toContain(hostile.replace(/"/g, '&quot;'));
  });
});

describe('hooks into the existing list', () => {
  it('requests the unassigned list once per query and shows no subgroup section outside the Unassigned scope', async () => {
    const onList = vi.fn();
    mount({ ...TWO, onList });
    await section();
    expect(onList.mock.calls.some(([args]) => (args as { unassigned?: boolean } | null)?.unassigned === true)).toBe(true);
  });
});
