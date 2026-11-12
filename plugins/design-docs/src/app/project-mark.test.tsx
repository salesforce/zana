// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UI_USER } from '../server/rpc.js';
import { DesignDocStore } from '../server/store.js';
import { createTestDatabase } from '../server/test-db.js';
import { NavPanel, ProjectTab } from './slots.js';
import { createHarness } from './test-harness.js';

function seed(store: DesignDocStore, title: string, projectId: string | null) {
  return store.create({ template: 'blank', title, projectId }, UI_USER);
}

const markers = () => [...document.querySelectorAll<HTMLElement>('.project-marker')];
const ungroup = () => fireEvent.click(screen.getByRole('button', { name: 'Group by project' }));
const headerMarker = () => document.querySelector<HTMLElement>('.dd-list-section-project .project-marker')!;
const markerFor = (title: string) => {
  const row = screen.getByText(title).closest('.dd-doc-row') as HTMLElement;
  return row.querySelector<HTMLElement>('.project-marker')!;
};

describe('project marker in Design Docs', () => {
  it('shows the host icon and color on list rows and section headers, and follows a recolor', async () => {
    const harness = createHarness({
      hostProjects: { status: 'ready', projects: [{ id: 'p1', name: 'App', icon: 'Rocket', color: '#ff0000' }, { id: 'p2', name: 'Site' }] }
    });
    seed(harness.store, 'Payments API', 'p1');
    const view = harness.render(<NavPanel pluginId="design-docs" subPath="" />);
    await screen.findByText('Payments API');
    await waitFor(() => expect(headerMarker().dataset.projectIcon).toBe('Rocket'));
    expect(headerMarker().style.color).toBe('#ff0000');
    ungroup();
    expect(markerFor('Payments API').dataset.projectIcon).toBe('Rocket');
    expect(markerFor('Payments API').style.color).toBe('#ff0000');

    harness.hostProjects.projects = [{ id: 'p1', name: 'App', icon: 'Cloud', color: '#00ff00' }];
    view.rerender(<NavPanel pluginId="design-docs" subPath="" />);
    await waitFor(() => expect(markerFor('Payments API').dataset.projectIcon).toBe('Cloud'));
    expect(markerFor('Payments API').style.color).toBe('#00ff00');
  });

  it('renders the neutral marker and the removed label for an unknown project', async () => {
    const harness = createHarness({ hostProjects: { status: 'ready', projects: [] } });
    seed(harness.store, 'Orphan', 'gone');
    harness.render(<NavPanel pluginId="design-docs" subPath="" />);
    await screen.findByText('Orphan');
    expect(headerMarker().className).toContain('project-marker--neutral');
    ungroup();
    const marker = markerFor('Orphan');
    expect(marker.className).toContain('project-marker--neutral');
    expect(marker.getAttribute('style')).toBeNull();
    expect(screen.getAllByText('Unknown project').length).toBeGreaterThan(0);
  });

  it('keeps the neutral marker while the host list is loading', async () => {
    const harness = createHarness({
      hostProjects: { status: 'loading', projects: [{ id: 'p1', name: 'App', icon: 'Rocket', color: '#ff0000' }] }
    });
    seed(harness.store, 'Payments API', 'p1');
    harness.render(<NavPanel pluginId="design-docs" subPath="" />);
    await screen.findByText('Payments API');
    ungroup();
    expect(markerFor('Payments API').className).toContain('project-marker--neutral');
    expect(markers().every((marker) => !marker.dataset.projectIcon)).toBe(true);
  });

  it('shows the project marker in the doc header chip', async () => {
    const harness = createHarness({
      hostProjects: { status: 'ready', projects: [{ id: 'p1', name: 'App', icon: 'Database', color: '#0000ff' }] }
    });
    const doc = seed(harness.store, 'Payments API', 'p1');
    localStorage.setItem('zcc.design-docs.project-location:p1', JSON.stringify(doc.id));
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    const chip = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.dd-doc-project .project-marker');
      if (!el) throw new Error('no chip');
      return el;
    });
    expect(chip.dataset.projectIcon).toBe('Database');
    expect(chip.style.color).toBe('#0000ff');
  });

  it('shows a neutral header marker for a removed project and none for a global doc', async () => {
    const harness = createHarness({ hostProjects: { status: 'ready', projects: [] } });
    const removed = seed(harness.store, 'Orphan', 'gone');
    localStorage.setItem('zcc.design-docs.project-location:p1', JSON.stringify(removed.id));
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    await screen.findByText('Unknown project');
    expect(document.querySelector('.dd-doc-project .project-marker--neutral')).toBeTruthy();
  });
});

describe('project marker context menu', () => {
  const rightClick = (el: Element) => fireEvent.contextMenu(el, { clientX: 41, clientY: 52 });

  it('opens the host appearance menu from the marker and the adjacent project name, without the doc menu', async () => {
    const calls: unknown[] = [];
    const harness = createHarness({
      hostProjects: { status: 'ready', projects: [{ id: 'p1', name: 'App', color: '#ff0000' }] },
      projects: [{ id: 'p1', name: 'App' }],
      onOpenProjectAppearanceMenu: (id, at) => calls.push([id, at])
    });
    seed(harness.store, 'Payments API', 'p1');
    harness.render(<NavPanel pluginId="design-docs" subPath="" />);
    await screen.findByText('Payments API');
    rightClick(headerMarker());
    rightClick(document.querySelector('.dd-list-section-project .dd-list-section-label')!);
    ungroup();
    rightClick(markerFor('Payments API'));
    rightClick(document.querySelector('.dd-doc-row-project-name')!);
    expect(calls).toEqual(Array(4).fill(['p1', { x: 41, y: 52 }]));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('leaves the doc row context menu alone when right-clicking elsewhere on the row', async () => {
    const calls: unknown[] = [];
    const harness = createHarness({
      hostProjects: { status: 'ready', projects: [{ id: 'p1', name: 'App' }] },
      projects: [{ id: 'p1', name: 'App' }],
      onOpenProjectAppearanceMenu: (id) => calls.push(id)
    });
    seed(harness.store, 'Payments API', 'p1');
    harness.render(<NavPanel pluginId="design-docs" subPath="" />);
    await screen.findByText('Payments API');
    ungroup();
    rightClick(screen.getByText('Payments API'));
    expect(calls).toEqual([]);
  });

  it('does nothing for an unknown project and lets the row handler run', async () => {
    const calls: unknown[] = [];
    const harness = createHarness({ hostProjects: { status: 'ready', projects: [] }, onOpenProjectAppearanceMenu: (id) => calls.push(id) });
    seed(harness.store, 'Orphan', 'gone');
    harness.render(<NavPanel pluginId="design-docs" subPath="" />);
    await screen.findByText('Orphan');
    ungroup();
    const notPrevented = rightClick(markerFor('Orphan'));
    expect(calls).toEqual([]);
    expect(notPrevented).toBe(false); // row handler (doc menu) prevented default
  });

  it('opens from the doc header project chip', async () => {
    const calls: unknown[] = [];
    const harness = createHarness({
      hostProjects: { status: 'ready', projects: [{ id: 'p1', name: 'App' }] },
      projects: [{ id: 'p1', name: 'App' }],
      onOpenProjectAppearanceMenu: (id, at) => calls.push([id, at])
    });
    const doc = seed(harness.store, 'Payments API', 'p1');
    localStorage.setItem('zcc.design-docs.project-location:p1', JSON.stringify(doc.id));
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    const chip = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.dd-doc-project .project-marker');
      if (!el) throw new Error('no chip');
      return el;
    });
    rightClick(chip);
    expect(calls).toEqual([['p1', { x: 41, y: 52 }]]);
  });
});
