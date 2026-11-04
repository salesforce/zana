// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DesignDocDetail } from '../shared/contract.js';
import { loadTarget, PublishButton } from './Publish.js';
import { createHarness, type Harness } from './test-harness.js';

async function siteDoc(harness: Harness, projectId: string | null = 'p1', template = 'html-design'): Promise<DesignDocDetail> {
  const summary = (await harness.call('create', { title: 'Collab', projectId, template })) as { id: string };
  return harness.store.get(summary.id);
}

const field = (name: string) => screen.getByRole(name === 'Branch' || name === 'Clone URL' ? 'textbox' : 'combobox', { name }) as HTMLInputElement;
const publishButton = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }) as HTMLButtonElement;
const openDialog = () => fireEvent.click(screen.getAllByRole('button', { name: 'Publish' })[0]!);
type Spawned = { projectId: string; prompt: string; title: string };

describe('Publish', () => {
  it("publishes to the project's own repository and remembers the target", async () => {
    const harness = createHarness({ panelAgent: true });
    const doc = await siteDoc(harness);
    harness.render(<PublishButton doc={doc} />);
    openDialog();
    expect(screen.getByRole('dialog', { name: 'Publish site' })).toBeTruthy();
    expect(field('Repository').value).toBe('own');
    expect(screen.queryByRole('textbox', { name: 'Clone URL' })).toBeNull();
    fireEvent.change(field('Folder'), { target: { value: 'docs' } });
    expect(screen.getByText('/docs', { selector: 'code' })).toBeTruthy();

    fireEvent.click(publishButton());
    await waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    const [request] = harness.spawn.mock.calls[0] as unknown as [Spawned];
    expect(request).toMatchObject({ projectId: 'p1', title: 'Publish · Collab' });
    expect(request.prompt).toContain("this project's repository, branch main, folder /docs");
    expect(harness.navigateCalls).toEqual([{ method: 'openPanelAgent', options: { threadId: 'thread-1', title: 'Collab' } }]);
    expect(harness.toasts.at(-1)).toEqual({ message: 'Publishing “Collab”. The agent reports the live URL when the push lands.', kind: 'info' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(loadTarget(doc.id)).toEqual({ repo: '', branch: 'main', folder: 'docs' });
  });

  it('publishes to another repository and shows where Pages serves it', async () => {
    const harness = createHarness();
    const doc = await siteDoc(harness);
    harness.render(<PublishButton doc={doc} compact />);
    openDialog();
    fireEvent.change(field('Repository'), { target: { value: 'other' } });
    expect(publishButton().disabled).toBe(true);

    fireEvent.change(field('Clone URL'), { target: { value: 'file:///tmp/x' } });
    expect(screen.getByRole('alert').textContent).toMatch(/clone URL/);
    expect(publishButton().disabled).toBe(true);

    fireEvent.change(field('Clone URL'), { target: { value: ' https://git.soma.salesforce.com/grebmann/design-site ' } });
    fireEvent.change(field('Branch'), { target: { value: 'a b' } });
    expect(screen.getByRole('alert').textContent).toMatch(/valid git branch/);
    fireEvent.change(field('Branch'), { target: { value: 'gh-pages' } });
    expect(screen.getByText('https://git.soma.salesforce.com/pages/grebmann/design-site/')).toBeTruthy();

    harness.fail('publish', 'no provider');
    fireEvent.click(publishButton());
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not start publishing: no provider', kind: 'error' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(loadTarget(doc.id).repo).toBe('');

    harness.restore('publish');
    fireEvent.click(publishButton());
    await waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    expect((harness.spawn.mock.calls[0] as unknown as [Spawned])[0].prompt).toContain('https://git.soma.salesforce.com/grebmann/design-site, branch gh-pages');
    expect(loadTarget(doc.id)).toEqual({ repo: 'https://git.soma.salesforce.com/grebmann/design-site', branch: 'gh-pages', folder: 'root' });

    // Publishing again starts from the saved target.
    openDialog();
    expect(field('Repository').value).toBe('other');
    expect(field('Clone URL').value).toBe('https://git.soma.salesforce.com/grebmann/design-site');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks which project runs the agent for a global doc', async () => {
    const harness = createHarness();
    const doc = await siteDoc(harness, null);
    harness.render(<PublishButton doc={doc} />);
    openDialog();
    const runIn = await screen.findByRole('combobox', { name: 'Run the agent in' });
    await waitFor(() => expect((runIn as HTMLSelectElement).value).toBe('p1'));
    fireEvent.change(runIn, { target: { value: 'p2' } });
    fireEvent.click(publishButton());
    await waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    expect((harness.spawn.mock.calls[0] as unknown as [Spawned])[0].projectId).toBe('p2');
  });

  it('defaults a global doc to the Default Project', async () => {
    const harness = createHarness({ projects: [{ id: 'p1', name: 'App' }, { id: 'quick', name: 'Default Project', quickAgent: true }] });
    const doc = await siteDoc(harness, null);
    harness.render(<PublishButton doc={doc} />);
    openDialog();
    const runIn = await screen.findByRole('combobox', { name: 'Run the agent in' });
    await waitFor(() => expect((runIn as HTMLSelectElement).value).toBe('quick'));
    fireEvent.click(publishButton());
    await waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    expect((harness.spawn.mock.calls[0] as unknown as [Spawned & { harness?: string }])[0]).toMatchObject({ projectId: 'quick', harness: 'project-default' });
  });

  it('explains when there is nothing to publish', async () => {
    const harness = createHarness();
    const notes = await siteDoc(harness, 'p1', 'blank');
    harness.render(<PublishButton doc={notes} />);
    openDialog();
    expect(screen.getByRole('alert').textContent).toBe('This doc has no HTML pages to publish. Add an index.html first.');
    expect(publishButton().disabled).toBe(true);
  });

  it('falls back to defaults when the saved target is unreadable', () => {
    localStorage.setItem('zcc.design-docs.publish.dd_x', '{bad');
    expect(loadTarget('dd_x')).toEqual({ repo: '', branch: 'main', folder: 'root' });
    localStorage.setItem('zcc.design-docs.publish.dd_x', JSON.stringify({ repo: 7, branch: '', folder: 'site' }));
    expect(loadTarget('dd_x')).toEqual({ repo: '', branch: 'main', folder: 'root' });
  });
});
