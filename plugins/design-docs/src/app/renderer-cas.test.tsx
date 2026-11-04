// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DesignDocStore } from '../server/store.js';
import { DesignDocSyncStore } from '../server/sync-store.js';
import { DesignDocPeerService } from '../server/peer-service.js';
import { createTestDatabase } from '../server/test-db.js';
import { UI_USER } from '../server/rpc.js';
import { DocView } from './DocView.js';
import { AGENT, createHarness } from './test-harness.js';

function replica(name: string) {
  const db = createTestDatabase();
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db); sync.initialize('repo', `replica-${name}`);
  sync.setGroup('repo', 'group', ['a', 'b'].map((id) => ({ replicaId: `replica-${id}`, machineId: `app-${id}`, sponsorReplicaId: null, joinedAt: 1 })));
  return { db, store, sync, service: new DesignDocPeerService(sync) };
}

async function projectHead(from: ReturnType<typeof replica>, to: ReturnType<typeof replica>, docId: string) {
  from.sync.freezeManual();
  const intent = from.sync.readyIntents('repo', 100, true).find((entry) => entry.docId === docId && entry.frozenHead === from.sync.head('repo', docId))!;
  await to.service.offer('app-a', from.service.createOffer(intent), {
    scope: 'repo', grantEpoch: 1, signal: new AbortController().signal, commitSync: async (fn) => fn()
  });
}

function show(harness: ReturnType<typeof createHarness>, docId: string, path = 'README.md') {
  harness.render(<DocView docId={docId} path={path} layout="workbench" onDeleted={() => {}} onOpenPath={() => {}} />);
}

const input = (path = 'README.md') => screen.getByRole('textbox', { name: `Edit ${path}` }) as HTMLTextAreaElement;
const edit = async (text: string, path = 'README.md') => {
  await screen.findByRole('group', { name: 'View mode' });
  fireEvent.click(within(screen.getByRole('group', { name: 'View mode' })).getByRole('button', { name: 'Edit' }));
  await waitFor(() => expect(input(path)).toBeTruthy());
  fireEvent.change(input(path), { target: { value: text } });
};

describe('renderer observed CAS', () => {
  it('follows clean inbound edits, then saves against refreshed identity and revision', async () => {
    const local = replica('a');
    const doc = local.store.create({ title: 'Clean refresh', template: 'blank' }, UI_USER);
    const harness = createHarness({ store: local.store });
    show(harness, doc.id);
    await screen.findByRole('group', { name: 'View mode' });
    fireEvent.click(within(screen.getByRole('group', { name: 'View mode' })).getByRole('button', { name: 'Edit' }));
    await screen.findByRole('textbox', { name: 'Edit README.md' });
    await harness.asAgent((store) => store.writeFile(doc.id, { path: 'README.md', content: 'Inbound clean edit' }, AGENT));
    await waitFor(() => expect(input().value).toBe('Inbound clean edit'));
    expect(screen.queryByRole('alert')).toBeNull();
    const observed = local.store.readFile(doc.id, 'README.md');
    fireEvent.change(input(), { target: { value: 'Next local edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(local.store.readFile(doc.id, 'README.md').content).toBe('Next local edit'));
    expect(harness.rpcCalls.find((call) => call.method === 'writeFile')!.input).toMatchObject({ baseRevision: observed.revision, baseFileId: observed.fileId });
  });

  it('pins history restore base across inbound replacement until explicit re-review', async () => {
    const local = replica('a');
    const doc = local.store.create({ title: 'History consent', files: [{ path: 'README.md', content: 'entry' }, { path: 'note.md', content: 'Historical note' }] }, UI_USER);
    local.store.writeFile(doc.id, { path: 'note.md', content: 'Current note' }, AGENT);
    const observed = local.store.readFile(doc.id, 'note.md');
    const harness = createHarness({ store: local.store });
    show(harness, doc.id, 'note.md');
    fireEvent.click(await screen.findByRole('tab', { name: 'History' }));
    const created = () => within(screen.getByRole('complementary', { name: 'Comments, history and agents' })).getByRole('button', { name: /^Created\s*rev 1\b/ });
    await waitFor(() => expect(created()).toBeTruthy());
    fireEvent.click(created());
    await screen.findByText('Historical note');
    await harness.asAgent((store) => {
      store.deleteFile(doc.id, 'note.md', AGENT);
      store.writeFile(doc.id, { path: 'note.md', content: 'Replacement note' }, AGENT);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'note.md' }).title).toContain('rev 4'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore', exact: true }));
    await waitFor(() => expect(harness.toasts.at(-1)?.message).toContain('identity changed'));
    expect(local.store.readFile(doc.id, 'note.md').content).toBe('Replacement note');
    expect(screen.getByText('Historical note')).toBeTruthy();
    expect(harness.rpcCalls.find((call) => call.method === 'restore')!.input).toMatchObject({ baseRevision: observed.revision, baseFileId: observed.fileId });
    fireEvent.click(screen.getByRole('button', { name: 'Close revision' }));
    fireEvent.click(created());
    await screen.findByText('Historical note');
    fireEvent.click(screen.getByRole('button', { name: 'Restore', exact: true }));
    await waitFor(() => expect(local.store.readFile(doc.id, 'note.md').content).toBe('Historical note'));
  });

  it.each([false, true])('preserves dirty buffer across inbound delete/recreate (deletion displayed: %s)', async (showDeletion) => {
    const a = replica('a'), b = replica('b');
    const doc = a.store.create({ title: 'Inbound ABA', files: [{ path: 'README.md', content: 'entry' }, { path: 'note.md', content: 'original' }] }, UI_USER);
    await projectHead(a, b, doc.id);
    const harness = createHarness({ store: b.store });
    const original = b.store.readFile(doc.id, 'note.md');
    show(harness, doc.id, 'note.md');
    await edit('Unsaved local buffer', 'note.md');
    a.store.deleteFile(doc.id, 'note.md', AGENT);
    await projectHead(a, b, doc.id);
    if (showDeletion) {
      harness.emit({ docId: doc.id });
      await screen.findByText(/^note.md was deleted or renamed/);
      expect(input('note.md').value).toBe('Unsaved local buffer');
    }
    a.store.writeFile(doc.id, { path: 'note.md', content: 'inbound replacement' }, AGENT);
    await projectHead(a, b, doc.id);
    const replacement = b.store.readFile(doc.id, 'note.md');
    expect(replacement.fileId).not.toBe(original.fileId);
    expect(replacement.revision).toBeGreaterThan(original.revision);
    harness.emit({ docId: doc.id });
    await screen.findByRole('button', { name: 'Overwrite with mine' });
    expect(input('note.md').value).toBe('Unsaved local buffer');
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toHaveProperty('disabled', true);
    expect(harness.rpcCalls.filter((call) => call.method === 'writeFile')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite with mine' }));
    await waitFor(() => expect(b.store.readFile(doc.id, 'note.md').content).toBe('Unsaved local buffer'));
    expect(harness.rpcCalls.find((call) => call.method === 'writeFile')!.input).toMatchObject({ baseFileId: replacement.fileId, baseRevision: replacement.revision });
  });

  it('refetches same-counter identity replacement and preserves dirty matching-content buffer', async () => {
    const local = replica('a');
    const doc = local.store.create({ title: 'Same counter', template: 'blank' }, UI_USER);
    const harness = createHarness({ store: local.store });
    show(harness, doc.id);
    await edit('My matching draft');
    local.db.prepare('UPDATE doc_files SET sync_id = ?, content = ?, size = ? WHERE doc_id = ? AND path = ?')
      .run('replacement-file', 'My matching draft', 17, doc.id, 'README.md');
    harness.emit({ docId: doc.id });
    await screen.findByRole('alert');
    expect(input().value).toBe('My matching draft');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard mine' }));
    await screen.findByText('Saved · rev 1');
    fireEvent.change(input(), { target: { value: 'Explicit new edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(local.store.readFile(doc.id, 'README.md').content).toBe('Explicit new edit'));
    expect(harness.rpcCalls.find((call) => call.method === 'writeFile')!.input).toMatchObject({ baseFileId: 'replacement-file', baseRevision: 1 });
  });

  it('rejects stale approval, then permits explicit re-review of replacement head', async () => {
    const local = replica('a');
    const doc = local.store.create({ title: 'Review consent', template: 'blank' }, UI_USER);
    const harness = createHarness({ store: local.store });
    show(harness, doc.id);
    await screen.findByTitle('Change status');
    fireEvent.click(screen.getByTitle('Change status'));
    await harness.asAgent((store) => store.writeFile(doc.id, { path: 'README.md', content: 'Unreviewed replacement' }, AGENT));
    await screen.findByText('Unreviewed replacement');
    const replacement = local.store.summary(doc.id).head;
    fireEvent.click(screen.getByRole('menuitem', { name: 'Approved' }));
    await waitFor(() => expect(harness.toasts.at(-1)?.message).toContain('head changed'));
    expect(local.sync.readyIntents('repo')).toEqual([]);
    expect(local.store.summary(doc.id).status).toBe('draft');
    expect(harness.rpcCalls.find((call) => call.method === 'update')!.input).toMatchObject({ expectedHead: doc.head });
    fireEvent.click(screen.getByTitle('Change status'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Approved' }));
    await waitFor(() => expect(local.store.summary(doc.id).status).toBe('approved'));
    expect(harness.rpcCalls.filter((call) => call.method === 'update').at(-1)!.input).toMatchObject({ expectedHead: replacement });
    expect(local.sync.readyIntents('repo')).toHaveLength(1);
  });

  it('retains buffer and base identity on silent CAS failure and disables unverified overwrite', async () => {
    const local = replica('a');
    const doc = local.store.create({ title: 'CAS failure', files: [{ path: 'README.md', content: 'entry' }, { path: 'note.md', content: 'original' }] }, UI_USER);
    const harness = createHarness({ store: local.store });
    show(harness, doc.id, 'note.md');
    await edit('Keep this buffer', 'note.md');
    const observed = local.store.readFile(doc.id, 'note.md');
    local.store.deleteFile(doc.id, 'note.md', AGENT);
    local.store.writeFile(doc.id, { path: 'note.md', content: 'silent replacement' }, AGENT);
    harness.fail('readFile', 'offline');
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await screen.findByRole('alert');
    expect(input('note.md').value).toBe('Keep this buffer');
    expect(screen.getByRole('button', { name: 'Overwrite with mine' })).toHaveProperty('disabled', true);
    expect(local.store.readFile(doc.id, 'note.md').content).toBe('silent replacement');
    expect(harness.rpcCalls.find((call) => call.method === 'writeFile')!.input).toMatchObject({ baseRevision: observed.revision, baseFileId: observed.fileId });
    harness.restore('readFile');
    harness.emit({ docId: doc.id });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Overwrite with mine' })).toHaveProperty('disabled', false));
    expect(input('note.md').value).toBe('Keep this buffer');
  });

  it('pins move dialog head and keeps failed selection for cancel/review', async () => {
    const local = replica('a');
    const doc = local.store.create({ title: 'Move consent', projectId: 'p1', template: 'blank' }, UI_USER);
    const harness = createHarness({ store: local.store });
    show(harness, doc.id);
    await screen.findByTitle('More actions');
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Move to project/ }));
    const dialog = screen.getByRole('dialog', { name: 'Move design doc' });
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'p2' } });
    await harness.asAgent((store) => store.writeFile(doc.id, { path: 'README.md', content: 'replacement' }, AGENT));
    await screen.findByText('replacement');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move', exact: true }));
    await waitFor(() => expect(harness.toasts.at(-1)?.message).toContain('head changed'));
    expect(screen.getByRole('dialog', { name: 'Move design doc' })).toBeTruthy();
    expect(within(dialog).getByRole('combobox')).toHaveProperty('value', 'p2');
    expect(local.store.summary(doc.id).projectId).toBe('p1');
    expect(harness.rpcCalls.find((call) => call.method === 'update')!.input).toMatchObject({ expectedHead: doc.head });
  });

  it.each(['delete', 'rename'])('pins %s confirmation identity and keeps dirty draft on replacement', async (mode) => {
    const local = replica('a');
    const doc = local.store.create({ title: 'File consent', files: [{ path: 'README.md', content: 'entry' }, { path: 'note.md', content: 'original' }] }, UI_USER);
    const harness = createHarness({ store: local.store });
    show(harness, doc.id, 'note.md');
    await edit('Retained draft', 'note.md');
    const observed = local.store.readFile(doc.id, 'note.md');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for note.md' }));
    fireEvent.click(screen.getByRole('menuitem', { name: mode === 'delete' ? 'Delete' : 'Rename or move' }));
    if (mode === 'rename') {
      fireEvent.change(screen.getByRole('textbox', { name: 'New path' }), { target: { value: 'moved.md' } });
      fireEvent.submit(screen.getByRole('textbox', { name: 'New path' }).closest('form')!);
    }
    const dialog = screen.getByRole('dialog', { name: mode === 'delete' ? 'Delete file' : 'Discard unsaved changes?' });
    await harness.asAgent((store) => {
      store.deleteFile(doc.id, 'note.md', AGENT);
      store.writeFile(doc.id, { path: 'note.md', content: 'replacement' }, AGENT);
    });
    await screen.findByRole('alert');
    fireEvent.click(within(dialog).getByRole('button', { name: mode === 'delete' ? 'Delete' : 'Discard and rename' }));
    await waitFor(() => expect(harness.toasts.at(-1)?.message).toContain('identity changed'));
    expect(input('note.md').value).toBe('Retained draft');
    expect(local.store.readFile(doc.id, 'note.md').content).toBe('replacement');
    expect(harness.rpcCalls.find((call) => call.method === (mode === 'delete' ? 'deleteFile' : 'renameFile'))!.input)
      .toMatchObject({ baseRevision: observed.revision, baseFileId: observed.fileId });
  });

  it.each(['Delete', 'Open first'])('pins file menu snapshot before %s selection', async (action) => {
    const local = replica('a');
    const doc = local.store.create({ title: 'Menu consent', files: [{ path: 'README.md', content: 'entry' }, { path: 'note.md', content: 'original' }] }, UI_USER);
    const harness = createHarness({ store: local.store });
    const observed = local.store.readFile(doc.id, 'note.md');
    show(harness, doc.id, 'note.md');
    await screen.findByRole('button', { name: 'Actions for note.md' });
    fireEvent.click(screen.getByRole('button', { name: 'Actions for note.md' }));
    await harness.asAgent((store) => {
      store.deleteFile(doc.id, 'note.md', AGENT);
      store.writeFile(doc.id, { path: 'note.md', content: 'replacement' }, AGENT);
    });
    await screen.findByText('replacement');
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${action}`) }));
    if (action === 'Delete') {
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete file' })).getByRole('button', { name: 'Delete' }));
    }
    await waitFor(() => expect(harness.toasts.at(-1)?.message).toContain(action === 'Delete' ? 'identity changed' : 'head changed'));
    expect(local.store.readFile(doc.id, 'note.md').content).toBe('replacement');
    expect(local.store.summary(doc.id).entryPath).toBe('README.md');
    expect(harness.rpcCalls.find((call) => call.method === (action === 'Delete' ? 'deleteFile' : 'update'))!.input)
      .toMatchObject(action === 'Delete' ? { baseRevision: observed.revision, baseFileId: observed.fileId } : { expectedHead: doc.head });
  });

  it('disables deleting the only file of a doc and never sends the request', async () => {
    const local = replica('a');
    const doc = local.store.create({ title: 'Single file', files: [{ path: 'README.md', content: 'entry' }] }, UI_USER);
    const harness = createHarness({ store: local.store });
    show(harness, doc.id, 'README.md');
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for README.md' }));
    const item = screen.getByRole('menuitem', { name: 'Delete' }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.title).toBe('A design doc needs at least one file. Delete the doc instead.');
    fireEvent.click(item);
    expect(screen.queryByRole('dialog', { name: 'Delete file' })).toBeNull();
    expect(harness.rpcCalls.some((call) => call.method === 'deleteFile')).toBe(false);
  });
});
