// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UI_USER } from '../server/rpc.js';
import { DesignDocStore } from '../server/store.js';
import { DesignDocSyncStore } from '../server/sync-store.js';
import { DesignDocPeerService } from '../server/peer-service.js';
import { createTestDatabase } from '../server/test-db.js';
import { createScopeHash } from '../server/peer-protocol.js';
import { canonicalPeerHash } from '../shared/peer-contract.js';
import { DocView } from './DocView.js';
import { PeerConflictView } from './PeerConflictView.js';
import { createHarness } from './test-harness.js';

function fixture(overlap = false) {
  const db = createTestDatabase();
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db); sync.initialize('repo', 'local');
  sync.setGroup('repo', 'group', ['local', 'remote'].map((id) => ({ replicaId: id, machineId: id, joinedAt: 1, sponsorReplicaId: null })));
  const doc = store.create({ title: 'Fork review', files: [{ path: 'README.md', content: 'one\ntwo\nthree' }] }, UI_USER);
  const base = sync.version('repo', doc.head!)!, remote = structuredClone(base);
  remote.operation = { ...remote.operation, id: 'remote-head', replicaId: 'remote', sequence: 1, parents: [doc.head!] };
  remote.closure.files[0]!.content = overlap ? 'Uno\ntwo\nthree' : 'one\ntwo\nTHREE';
  remote.closure.files[0]!.size = Buffer.byteLength(remote.closure.files[0]!.content);
  remote.operation.payloadHash = canonicalPeerHash(remote.closure);
  store.writeFile(doc.id, { path: 'README.md', content: 'ONE\ntwo\nthree' }, UI_USER);
  const body = { protocolVersion: 2, repoId: 'repo', senderReplicaId: 'remote', recipientReplicaId: 'local', grantEpoch: 1,
    groupId: 'group', rosterEpoch: 1, sessionId: 'session', versions: [base, remote], heads: { [doc.id]: 'remote-head' } };
  sync.apply({ ...body, scopeHash: createScopeHash(body) });
  const peerSync = new DesignDocPeerService(sync, (docId) => harness.emit({ docId }));
  const harness = createHarness({ store, peerSync });
  return { db, store, sync, doc, harness };
}

describe('peer conflict review', () => {
  it('resolves merged candidate through doc header while retaining unsaved editor buffer', async () => {
    const { store, sync, doc, harness } = fixture();
    harness.render(<DocView docId={doc.id} path="README.md" layout="workbench" onOpenPath={() => {}} onDeleted={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit', exact: true }));
    const editor = await screen.findByRole('textbox', { name: 'Edit README.md' }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'Unsaved buffer stays here' } });
    fireEvent.click(screen.getByRole('button', { name: 'Peer conflicts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Peer conflicts' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Resolve reviewed fork' })).toHaveProperty('disabled', false));
    const expectedHead = sync.head('repo', doc.id);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve reviewed fork' }));
    await within(dialog).findByText('No unresolved peer forks.');
    expect(store.readFile(doc.id, 'README.md').content).toBe('ONE\ntwo\nTHREE');
    await waitFor(() => expect(editor.value).toBe('Unsaved buffer stays here'));
    expect(harness.rpcCalls.find((call) => call.method === 'resolvePeerConflict')?.input)
      .toMatchObject({ expectedHead, remoteHead: 'remote-head', choice: 'merge' });
    expect(sync.readyIntents('repo')).toEqual([]);
  });

  it('retains failed review, rejects stale CAS and allows explicit rereview and peer selection', async () => {
    const { store, sync, doc, harness } = fixture(true);
    harness.render(<PeerConflictView docId={doc.id} onClose={() => {}} />);
    await screen.findByText(/overlapping text edits/);
    const resolve = await screen.findByRole('button', { name: 'Resolve reviewed fork' });
    expect(resolve).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('combobox', { name: 'Resolution' }), { target: { value: 'remote' } });
    await waitFor(() => expect(resolve).toHaveProperty('disabled', false));
    const oldHead = sync.head('repo', doc.id);
    store.writeFile(doc.id, { path: 'README.md', content: 'Newer local edit' }, UI_USER);
    fireEvent.click(resolve);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toMatch(/head changed/);
    expect(store.readFile(doc.id, 'README.md').content).toBe('Newer local edit');
    expect(harness.rpcCalls.find((call) => call.method === 'resolvePeerConflict')?.input).toMatchObject({ expectedHead: oldHead });
    fireEvent.click(screen.getByRole('button', { name: 'Review again' }));
    await waitFor(() => expect(resolve).toHaveProperty('disabled', false));
    await act(async () => { fireEvent.click(resolve); });
    await screen.findByText('No unresolved peer forks.');
    expect(store.readFile(doc.id, 'README.md').content).toBe('Uno\ntwo\nthree');
  });

  it.each(['peerConflicts', 'peerConflictReview', 'peerConflictFile'])('shows %s errors without resolving or changing fork', async (method) => {
    const { doc, harness, sync } = fixture();
    harness.fail(method, 'offline');
    harness.render(<PeerConflictView docId={doc.id} onClose={() => {}} />);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toBe('offline');
    expect(harness.rpcCalls.some((call) => call.method === 'resolvePeerConflict')).toBe(false);
    expect(sync.conflicts(doc.id).remoteHeads).toEqual(['remote-head']);
  });

  it('closes using keyboard and shows empty standalone state', async () => {
    const harness = createHarness(), doc = harness.store.create({ title: 'Local', template: 'blank' }, UI_USER);
    let closed = false;
    harness.render(<PeerConflictView docId={doc.id} onClose={() => { closed = true; }} />);
    await screen.findByText('No unresolved peer forks.');
    fireEvent.keyDown(document, { key: 'Escape' }); expect(closed).toBe(true);
  });

  it('offers rereview when file response comes from a newer head than metadata review', async () => {
    const { doc, harness } = fixture();
    const file = await harness.call('peerConflictFile', { doc: doc.id, remoteHead: 'remote-head', path: 'README.md' });
    const api = (globalThis as any).__ZCC_PLUGIN_RUNTIME__.useRpc();
    const call = api.call.bind(api);
    api.call = (method: string, args: unknown) => method === 'peerConflictFile' ? Promise.resolve({ ...(file as object), localHead: 'newer-head' }) : call(method, args);
    harness.render(<PeerConflictView docId={doc.id} onClose={() => {}} />);
    await screen.findByText(/head changed/i);
    expect(screen.getByRole('button', { name: 'Resolve reviewed fork' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Review again' })).toBeTruthy();
  });

  it('rereviews remaining file when selected local-only file was removed', async () => {
    const { store, sync, doc, harness } = fixture();
    store.writeFile(doc.id, { path: 'extra.md', content: 'Local only' }, UI_USER);
    harness.render(<PeerConflictView docId={doc.id} onClose={() => {}} />);
    const file = await screen.findByRole('combobox', { name: 'File' });
    fireEvent.change(file, { target: { value: 'extra.md' } });
    await screen.findAllByText('Local only');
    const oldHead = sync.head('repo', doc.id);
    store.deleteFile(doc.id, 'extra.md', UI_USER);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve reviewed fork' }));
    await screen.findByRole('alert');
    expect(harness.rpcCalls.find((call) => call.method === 'resolvePeerConflict')?.input).toMatchObject({ expectedHead: oldHead });
    fireEvent.click(screen.getByRole('button', { name: 'Review again' }));
    await waitFor(() => expect(file).toHaveProperty('value', 'README.md'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resolve reviewed fork' })).toHaveProperty('disabled', false));
    expect(harness.rpcCalls.at(-1)).toMatchObject({ method: 'peerConflictFile', input: { path: 'README.md' } });
  });
});
