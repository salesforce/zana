// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { UI_USER } from '../server/rpc.js';
import { createHarness } from './test-harness.js';
import { NavPanel, ProjectTab } from './slots.js';

function seed(harness: ReturnType<typeof createHarness>, input: { title: string; projectId?: string | null; template?: string; summary?: string; tags?: string[] }) {
  return harness.store.create({ template: 'blank', ...input, projectId: input.projectId ?? null }, UI_USER);
}

describe('plugin app', () => {
  it('registers every slot and injects its stylesheet once', async () => {
    createHarness();
    const module = await import('../../app.js');
    const app = collectTestPluginApp(module.default, 'design-docs', 1);
    expect(app.navPanels.map((slot) => slot.id)).toEqual(['design-docs']);
    expect(app.projectTabs.map((slot) => slot.id)).toEqual(['design']);
    expect(app.messageDirectives.map((slot) => slot.id)).toEqual(['design-doc']);
    expect(app.threadPanelActions.map((slot) => slot.id)).toEqual(['design-doc']);
    expect(app.messageActions.map((slot) => slot.id)).toEqual(['save-design-doc']);
    module.injectStyles();
    expect(document.querySelectorAll('#design-docs-plugin-styles')).toHaveLength(1);
    expect(document.getElementById('design-docs-plugin-styles')!.textContent).toContain('.dd-root');
  });
});

describe('workbench', () => {
  it('starts on the landing page and creates a doc from a template', async () => {
    const harness = createHarness();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    expect(await screen.findByText('Design docs your agents work on with you')).toBeTruthy();
    expect(await screen.findByText('No design docs yet.')).toBeTruthy();

    const landing = screen.getByText('Start from a template').parentElement!;
    fireEvent.click(await within(landing).findByRole('radio', { name: /Decision record/ }));
    const dialog = screen.getByRole('dialog', { name: 'New design doc' });
    expect((await within(dialog).findByRole('radio', { name: /Decision record/ })).getAttribute('aria-checked')).toBe('true');
    const create = within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Offline sync for the mobile app'), { target: { value: 'Use SQLite' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/One line agents see/), { target: { value: 'Storage choice' } });
    fireEvent.change(within(dialog).getByPlaceholderText('sync, mobile'), { target: { value: 'Storage, , DB' } });
    fireEvent.click(create);

    expect(await screen.findByRole('button', { name: 'Use SQLite' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'New design doc' })).toBeNull();
    const [doc] = harness.store.list({});
    expect(doc).toMatchObject({ title: 'Use SQLite', summary: 'Storage choice', projectId: 'p1', tags: ['storage', 'db'] });
    expect(await screen.findByRole('navigation', { name: 'Files' })).toBeTruthy();
    expect(localStorage.getItem('zcc.design-docs.project-location:p1')).toBe(JSON.stringify(doc!.id));
  });
});

export { seed };
