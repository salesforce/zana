// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProjectTab } from './slots.js';
import { createHarness } from './test-harness.js';

const USER = { kind: 'user' as const, label: 'You', threadId: null };

describe('Design Docs settings: Agent section', () => {
  it('explains that agents follow the project AI harness, with no controls', async () => {
    const harness = createHarness();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    expect(screen.getByRole('button', { name: 'Agent' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Peers' }).getAttribute('aria-current')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Database sync peers' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Agent harness' })).toBeTruthy();
    const section = screen.getByRole('region', { name: 'Agent harness' });
    expect([...section.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'the doc’s project;'.replace('’', "'"),
      'for a doc with no project, the Default Project;',
      'anything the project leaves unset, the global AI harness settings.'
    ]);
    expect(section.textContent).toContain("the agent won't start and the error names that setting");
    expect(section.textContent).toContain('Settings → AI Harness');
    expect(section.querySelector('input, select, button')).toBeNull();
    // The section choice is remembered for the next visit.
    expect(localStorage.getItem('zcc.design-docs.settings-tab')).toBe(JSON.stringify('agent'));
  });
});

describe('Design Docs agents spawn on the project AI harness', () => {
  it('spawns Ask agent with harness project-default and no provider', async () => {
    const harness = createHarness();
    const doc = harness.store.create({ title: 'Payments', template: 'blank', projectId: 'p1' }, USER);
    localStorage.setItem('zcc.design-docs.project-location:p1', JSON.stringify(doc.id));
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Ask agent/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Fill the gaps/ }));
    await waitFor(() => expect(harness.spawn).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1',
      harness: 'project-default'
    })));
    expect(harness.spawn.mock.calls[0]![0]).not.toHaveProperty('providerId');
    expect(harness.spawn.mock.calls[0]![0]).not.toHaveProperty('harnessRouting');
  });

  it('surfaces why the project harness cannot start the agent', async () => {
    const harness = createHarness();
    harness.spawn.mockRejectedValueOnce(new Error(
      'Claude Code cannot apply the AI harness override: the plan execution state is not supported by this thread provider. '
      + 'Change it in Settings → AI Harness.'
    ));
    const doc = harness.store.create({ title: 'Payments', template: 'blank', projectId: 'p1' }, USER);
    localStorage.setItem('zcc.design-docs.project-location:p1', JSON.stringify(doc.id));
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Ask agent/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Fill the gaps/ }));
    await waitFor(() => expect(harness.toasts.at(-1)?.kind).toBe('error'));
    expect(harness.toasts.at(-1)?.message).toContain(
      'Claude Code cannot apply the AI harness override: the plan execution state is not supported by this thread provider.'
    );
  });
});
