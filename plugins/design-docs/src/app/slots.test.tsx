// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UI_USER } from '../server/rpc.js';
import { DirectiveCard, ThreadPanel, saveMessageAsDoc } from './slots.js';
import { createHarness, type Harness } from './test-harness.js';

function twoFileDoc(harness: Harness, projectId: string | null = 'p1') {
  const doc = harness.store.create(
    {
      title: 'Payments',
      projectId,
      files: [
        { path: 'README.md', content: 'Overview' },
        { path: 'api.md', content: 'Endpoints' }
      ]
    },
    UI_USER
  );
  harness.store.addComment(doc.id, { body: 'Open question' }, UI_USER);
  return doc;
}

function card(attributes: Record<string, string>) {
  return (
    <DirectiveCard
      pluginId="design-docs"
      attributes={attributes}
      source={`::design-doc{id="${attributes.id ?? ''}"}`}
      message={{ threadId: 'thread-chat' } as never}
      openWorkspaceFile={null}
    />
  );
}

describe('design doc card in chat', () => {
  it('opens the doc beside the conversation, or in the panel', async () => {
    const harness = createHarness();
    const doc = twoFileDoc(harness);
    harness.render(card({ id: doc.id, path: 'api.md' }));

    const main = await screen.findByTitle('Open Payments beside this conversation');
    expect(main.textContent).toContain('api.md');
    expect(main.textContent).toContain('2 files · 1 open comment');
    fireEvent.click(main);
    expect(harness.navigateCalls).toEqual([
      { method: 'openThreadPanel', options: { actionId: 'design-doc', title: 'Payments', params: { docId: doc.id, path: 'api.md' }, threadId: 'thread-chat' } }
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Open in Design Docs' }));
    expect(harness.navigateCalls.at(-1)).toEqual({ method: 'toPluginPanel', path: 'design-docs', options: { subPath: `${doc.id}/api.md` } });
  });

  it('falls back to the panel when there is no thread to open beside', async () => {
    const harness = createHarness({ threadPanel: false });
    const doc = harness.store.create({ title: 'Solo', projectId: 'p1', template: 'blank' }, UI_USER);
    harness.render(card({ id: doc.id }));
    const main = await screen.findByTitle('Open Solo beside this conversation');
    expect(main.textContent).toContain('1 file');
    expect(main.textContent).not.toContain('open comment');
    fireEvent.click(main);
    expect(harness.navigateCalls.at(-1)).toEqual({ method: 'toPluginPanel', path: 'design-docs', options: { subPath: doc.id } });
  });

  it('explains broken links', async () => {
    const harness = createHarness();
    const { unmount } = harness.render(card({ id: '  ' }));
    expect(screen.getByRole('alert').textContent).toBe('Invalid design doc link: an id is required.');
    unmount();
    harness.render(card({ id: 'dd_unknown' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/^Design doc unavailable: /));
  });
});

describe('thread side panel', () => {
  it('picks a doc of the thread project, then goes back to the list', async () => {
    const harness = createHarness();
    twoFileDoc(harness);
    harness.store.create({ title: 'Glossary', projectId: null, template: 'blank', summary: 'Shared terms' }, UI_USER);
    harness.store.create({ title: 'Elsewhere', projectId: 'p2', template: 'blank' }, UI_USER);
    harness.render(<ThreadPanel pluginId="design-docs" threadId="thread-chat" projectId="p1" params={null} />);

    expect(await screen.findByText('Design docs')).toBeTruthy();
    expect(await screen.findByText('Payments')).toBeTruthy();
    expect(screen.getByText('Shared terms')).toBeTruthy();
    expect(screen.queryByText('Elsewhere')).toBeNull();

    fireEvent.click(screen.getByText('Payments'));
    expect(await screen.findByTitle('Files in this doc')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Design Docs' }));
    expect(harness.navigateCalls.at(-1)).toMatchObject({ method: 'toPluginPanel', path: 'design-docs' });

    fireEvent.click(screen.getByTitle('Files in this doc'));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Files' })).getByRole('button', { name: /^api\.md/ }));
    expect(await screen.findByText('Endpoints')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'All design docs' }));
    expect(await screen.findByText('Glossary')).toBeTruthy();
  });

  it('opens the doc and file passed in the panel params', async () => {
    const harness = createHarness();
    const doc = twoFileDoc(harness);
    harness.render(<ThreadPanel pluginId="design-docs" threadId="thread-chat" projectId="p1" params={{ docId: doc.id, path: 'api.md' }} />);
    expect(await screen.findByText('Endpoints')).toBeTruthy();
    // Opened for a specific doc: no way back to a picker it never showed.
    expect(screen.queryByRole('button', { name: 'All design docs' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Design Docs' }));
    expect(harness.navigateCalls.at(-1)).toEqual({ method: 'toPluginPanel', path: 'design-docs', options: { subPath: `${doc.id}/api.md` } });
  });

  it('follows new panel params when the host reuses the panel', async () => {
    const harness = createHarness();
    const payments = twoFileDoc(harness);
    const glossary = harness.store.create(
      { title: 'Glossary', projectId: 'p1', files: [{ path: 'README.md', content: 'Shared terms' }] },
      UI_USER
    );
    const panel = (params: Record<string, string>) => (
      <ThreadPanel pluginId="design-docs" threadId="thread-chat" projectId="p1" params={params} />
    );
    const { rerender } = harness.render(panel({ docId: payments.id, path: 'api.md' }));
    expect(await screen.findByText('Endpoints')).toBeTruthy();

    rerender(panel({ docId: glossary.id }));
    expect(await screen.findByText('Shared terms')).toBeTruthy();
    expect(screen.queryByText('Endpoints')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Design Docs' }));
    expect(harness.navigateCalls.at(-1)).toMatchObject({ options: { subPath: glossary.id } });
  });

  it('creates a doc from the empty picker and returns to it after deleting', async () => {
    const harness = createHarness();
    harness.render(<ThreadPanel pluginId="design-docs" threadId="thread-chat" params={['not', 'an', 'object']} />);
    expect(await screen.findByText('No design docs here yet')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    const dialog = screen.getByRole('dialog', { name: 'New design doc' });
    await within(dialog).findAllByRole('radio');
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Offline sync for the mobile app'), { target: { value: 'Side notes' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByTitle('Files in this doc')).toBeTruthy();
    const [doc] = harness.store.list({});
    expect(doc).toMatchObject({ title: 'Side notes' });

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete design doc' })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('No design docs here yet')).toBeTruthy();
  });

  it('shows picker errors', async () => {
    const harness = createHarness();
    harness.fail('list', 'offline');
    harness.render(<ThreadPanel pluginId="design-docs" threadId="thread-chat" projectId="p1" params={{ docId: '' }} />);
    expect(await screen.findByText('offline')).toBeTruthy();
  });
});

describe('save as design doc', () => {
  const message = (text: string) => ({ text }) as never;

  it('saves the message, or the selected part, and opens it', async () => {
    const harness = createHarness();
    const openPanel = vi.fn(() => true);
    await saveMessageAsDoc({ threadId: 'thread-chat', message: message('# Caching plan\n\nUse a CDN.'), openPanel });
    const [doc] = harness.store.list({});
    expect(doc).toMatchObject({ title: 'Caching plan', projectId: 'p1' });
    expect(harness.store.readFile(doc!.id, 'README.md').content).toBe('# Caching plan\n\nUse a CDN.');
    expect(harness.store.get(doc!.id).threads).toEqual([expect.objectContaining({ threadId: 'thread-chat', title: 'Planner' })]);
    expect(openPanel).toHaveBeenCalledWith({ actionId: 'design-doc', title: 'Caching plan', params: { docId: doc!.id } });
    expect(harness.toasts.at(-1)).toEqual({ message: 'Saved “Caching plan” as a design doc', kind: 'info' });

    await saveMessageAsDoc({ threadId: 'thread-chat', message: message('Everything'), selectedText: '  ## Only this part  ', openPanel });
    const selected = harness.store.list({}).find((entry) => entry.title === 'Only this part')!;
    expect(harness.store.readFile(selected.id, 'README.md').content).toBe('## Only this part');
  });

  it('reports empty messages and failures', async () => {
    const harness = createHarness();
    const openPanel = vi.fn(() => true);
    await saveMessageAsDoc({ threadId: 'thread-chat', message: message('   '), selectedText: ' ', openPanel });
    expect(harness.toasts).toEqual([{ message: 'This message has no text to save.', kind: 'error' }]);

    await saveMessageAsDoc({ threadId: 'missing', message: message('Plan'), openPanel });
    expect(harness.toasts.at(-1)).toEqual({ message: 'Could not save the design doc: Thread missing was not found.', kind: 'error' });
    expect(openPanel).not.toHaveBeenCalled();
    expect(harness.store.list({})).toEqual([]);
  });
});
