/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { ProjectStatusbarItems, sortProjectStatusbarItems } from './ProjectStatusbarItems.js';
import { clearPluginSlots, interpretPluginApp, listProjectStatusbarItems } from './plugin-slots.js';

afterEach(() => {
  cleanup();
  clearPluginSlots('salesforce');
  clearPluginSlots('notes');
});

describe('sortProjectStatusbarItems', () => {
  it('filters by align and sorts by order then pluginId', () => {
    interpretPluginApp(
      'notes',
      definePluginApp((app) => {
        app.slots.projectStatusbarItem({ id: 'later', align: 'left', order: 20, label: 'later' });
        app.slots.projectStatusbarItem({ id: 'first', align: 'left', order: 5, label: 'first' });
        app.slots.projectStatusbarItem({ id: 'right', align: 'right', label: 'right' });
      })
    );
    const items = listProjectStatusbarItems();
    expect(sortProjectStatusbarItems(items, 'left').map((row) => row.id)).toEqual(['first', 'later']);
    expect(sortProjectStatusbarItems(items, 'right').map((row) => row.id)).toEqual(['right']);
  });
});

describe('ProjectStatusbarItems', () => {
  it('places chips on the requested side and opens a menu, dialog, and project tab', () => {
    const navigated: string[] = [];
    interpretPluginApp(
      'salesforce',
      definePluginApp((app) => {
        app.slots.projectTab({ id: 'soql', label: 'SOQL', icon: 'Database', component: () => null });
        app.slots.projectStatusbarItem({
          id: 'orgs',
          align: 'right',
          icon: 'Cloud',
          label: 'orgs',
          component: ({ close }) => (
            <button type="button" onClick={close}>
              Switch org
            </button>
          ),
          run: (ctx) => {
            ctx.openMenu([
              {
                id: 'prod',
                label: 'Production',
                run: () => {
                  ctx.openDialog({ title: 'Switch org' });
                }
              },
              {
                id: 'soql',
                label: 'Open SOQL',
                run: () => {
                  ctx.toProject(ctx.projectId, { tabId: 'soql' });
                }
              }
            ]);
          }
        });
        app.slots.projectStatusbarItem({
          id: 'hint',
          align: 'left',
          label: 'hint'
        });
      })
    );

    const { rerender } = render(
      <>
        <ProjectStatusbarItems projectId="proj-1" align="left" navigate={(to) => navigated.push(to)} />
        <ProjectStatusbarItems projectId="proj-1" align="right" navigate={(to) => navigated.push(to)} />
      </>
    );

    expect(screen.getByTestId('project-statusbar-left').textContent).toContain('hint');
    expect(screen.getByTestId('project-statusbar-right').textContent).toContain('orgs');

    fireEvent.click(screen.getByRole('button', { name: 'orgs' }));
    expect(screen.getByRole('menuitem', { name: 'Production' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open SOQL' }));
    expect(navigated).toEqual(['/projects/proj-1/salesforce']);

    rerender(
      <>
        <ProjectStatusbarItems projectId="proj-1" align="left" navigate={(to) => navigated.push(to)} />
        <ProjectStatusbarItems projectId="proj-1" align="right" navigate={(to) => navigated.push(to)} />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: 'orgs' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Production' }));
    expect(screen.getByRole('dialog', { name: 'Switch org' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Switch org' }));
    expect(screen.queryByRole('dialog', { name: 'Switch org' })).toBeNull();
  });

  it('mounts a live item inside the plugin boundary', () => {
    interpretPluginApp(
      'notes',
      definePluginApp((app) => {
        app.slots.projectStatusbarItem({
          id: 'live',
          align: 'right',
          item: ({ openMenu }) => (
            <button type="button" onClick={() => openMenu([{ id: 'a', label: 'Alpha', run: () => undefined }])}>
              live-chip
            </button>
          )
        });
      })
    );
    render(<ProjectStatusbarItems projectId="proj-1" align="right" navigate={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'live-chip' }));
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toBeTruthy();
  });

  it('swallows a throwing run', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    interpretPluginApp(
      'notes',
      definePluginApp((app) => {
        app.slots.projectStatusbarItem({
          id: 'boom',
          label: 'boom',
          run: () => {
            throw new Error('chip failed');
          }
        });
      })
    );
    render(<ProjectStatusbarItems projectId="proj-1" align="right" navigate={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'boom' }));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
