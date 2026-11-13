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

function fixture(overlap = false, extra: { twoFiles?: boolean; title?: boolean } = {}) {
  const db = createTestDatabase();
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db); sync.initialize('repo', 'local');
  sync.setGroup('repo', 'group', ['local', 'remote'].map((id) => ({ replicaId: id, machineId: id, joinedAt: 1, sponsorReplicaId: null })));
  const doc = store.create({ title: 'Fork review', files: [{ path: 'README.md', content: 'one\ntwo\nthree' }, ...(extra.twoFiles ? [{ path: 'plan.md', content: 'a\nb\nc' }] : [])] }, UI_USER);
  const base = sync.version('repo', doc.head!)!, remote = structuredClone(base);
  remote.operation = { ...remote.operation, id: 'remote-head', replicaId: 'remote', sequence: 1, parents: [doc.head!] };
  remote.closure.files[0]!.content = overlap ? 'Uno\ntwo\nthree' : 'one\ntwo\nTHREE';
  remote.closure.files[0]!.size = Buffer.byteLength(remote.closure.files[0]!.content);
  remote.operation.payloadHash = canonicalPeerHash(remote.closure);
  if (extra.twoFiles) {
    const plan = remote.closure.files.find((file) => file.path === 'plan.md')!;
    plan.content = 'R\nb\nc'; plan.size = Buffer.byteLength(plan.content);
  }
  if (extra.title) remote.closure.doc.title = 'Remote title';
  remote.operation.payloadHash = canonicalPeerHash(remote.closure);
  store.writeFile(doc.id, { path: 'README.md', content: 'ONE\ntwo\nthree' }, UI_USER);
  if (extra.twoFiles) store.writeFile(doc.id, { path: 'plan.md', content: 'L\nb\nc' }, UI_USER);
  if (extra.title) store.update(doc.id, { title: 'Local title', expectedHead: sync.head('repo', doc.id)! }, UI_USER);
  const body = { protocolVersion: 2, repoId: 'repo', senderReplicaId: 'remote', recipientReplicaId: 'local', grantEpoch: 1,
    groupId: 'group', rosterEpoch: 1, sessionId: 'session', versions: [base, remote], heads: { [doc.id]: 'remote-head' } };
  sync.apply({ ...body, scopeHash: createScopeHash(body) });
  const peerSync = new DesignDocPeerService(sync, (docId) => harness.emit({ docId }));
  const harness = createHarness({ store, peerSync });
  return { db, store, sync, doc, harness };
}

describe('peer conflict review', () => {
  it('explains failed projection resolution without discarding reviewed forks', async () => {
    const { doc, harness, sync } = fixture();
    harness.fail('resolvePeerConflict', 'resolution projection does not match candidate');
    harness.render(<PeerConflictView docId={doc.id} onClose={() => {}} />);
    const button = await screen.findByRole('button', { name: 'Resolve reviewed fork' });
    await waitFor(() => expect(button).toHaveProperty('disabled', false));
    fireEvent.click(button);
    await screen.findByText(/No changes were saved/);
    expect(screen.getByRole('alert').textContent).toContain('resolution projection does not match candidate');
    expect(screen.getByRole('alert').textContent).toContain('Review again');
    expect(sync.conflicts(doc.id).remoteHeads).toEqual(['remote-head']);
  });

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

  it('asks one question per contested file, shows a diff per side, and keeps the draft across a stale-head block', async () => {
    const { store, sync, doc, harness } = fixture(true);
    harness.render(<PeerConflictView docId={doc.id} onClose={() => {}} />);
    await screen.findByText('File 1 of 1');
    expect(screen.getByText(/1 item differs: README.md/)).toBeTruthy();
    const mine = await screen.findByRole('region', { name: 'Mine compared with common version changes' });
    expect(mine.textContent).toContain('-removed: one'); expect(mine.textContent).toContain('+added: ONE');
    expect(screen.getByRole('region', { name: 'Theirs compared with common version changes' }).textContent).toContain('+added: Uno');
    const group = screen.getByRole('group', { name: 'Choose version for README.md' });
    expect(within(group).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['local', 'remote']);
    expect(screen.queryByRole('radio', { name: /Keep both/ })).toBeNull();
    const resolve = screen.getByRole('button', { name: 'Resolve reviewed fork' });
    expect(resolve).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('radio', { name: 'Use theirs' }));
    await waitFor(() => expect(resolve).toHaveProperty('disabled', false));
    const oldHead = sync.head('repo', doc.id);
    store.writeFile(doc.id, { path: 'README.md', content: 'Newer local edit' }, UI_USER);
    fireEvent.click(resolve);
    await screen.findByText(/Resolution failed/);
    expect(screen.getByRole('alert').textContent).toMatch(/head changed/);
    expect(store.readFile(doc.id, 'README.md').content).toBe('Newer local edit');
    expect(harness.rpcCalls.find((call) => call.method === 'resolvePeerConflict')?.input).toMatchObject({ expectedHead: oldHead, choices: { 'file:README.md': 'remote' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review again' }));
    await waitFor(() => expect((screen.getByRole('radio', { name: 'Use theirs' }) as HTMLInputElement).checked).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resolve reviewed fork' })).toHaveProperty('disabled', false));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resolve reviewed fork' })); });
    await screen.findByText('No unresolved peer forks.');
    expect(store.readFile(doc.id, 'README.md').content).toBe('Uno\ntwo\nthree');
  });

  it('walks two file questions with Back and Next, announces the step, and sends both choices', async () => {
    const { store, doc, harness } = fixture(true, { twoFiles: true });
    harness.render(<PeerConflictView docId={doc.id} onClose={() => {}} />);
    await screen.findByText('File 1 of 2');
    expect(screen.getByRole('status', { name: '' }).textContent).toBe('File 1 of 2');
    const next = screen.getByRole('button', { name: 'Next' }), back = screen.getByRole('button', { name: 'Back' });
    expect(back).toHaveProperty('disabled', true); expect(next).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Resolve reviewed fork' })?.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Keep mine' }));
    fireEvent.click(next);
    await screen.findByText('File 2 of 2');
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Resolve reviewed fork' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('radio', { name: 'Use theirs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText('File 1 of 2');
    expect((screen.getByRole('radio', { name: 'Keep mine' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('File 2 of 2');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resolve reviewed fork' })); });
    await screen.findByText('No unresolved peer forks.');
    expect(harness.rpcCalls.find((call) => call.method === 'resolvePeerConflict')?.input)
      .toMatchObject({ choices: { 'file:README.md': 'local', 'file:plan.md': 'remote' } });
    expect(store.readFile(doc.id, 'README.md').content).toBe('ONE\ntwo\nthree');
    expect(store.readFile(doc.id, 'plan.md').content).toBe('R\nb\nc');
  });

  it('shows field questions as one line each with both values', async () => {
    const { store, doc, harness } = fixture(true, { title: true });
    harness.render(<PeerConflictView docId={doc.id} onClose={() => {}} />);
    await screen.findByText('File 1 of 2');
    fireEvent.click(screen.getByRole('radio', { name: 'Keep mine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('File 2 of 2');
    expect(screen.getByText('Local title', { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText('Remote title', { selector: 'dd' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Use theirs' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resolve reviewed fork' })); });
    await screen.findByText('No unresolved peer forks.');
    expect(store.get(doc.id).title).toBe('Remote title');
  });

  it('lists untouched files as settled, links to history after resolving', async () => {
    const { doc, harness } = fixture();
    let opened = false;
    harness.render(<PeerConflictView docId={doc.id} onClose={() => {}} onOpenHistory={() => { opened = true; }} />);
    const summary = await screen.findByText('1 files need no choice');
    fireEvent.click(summary);
    expect(screen.getByText(/README.md: changed in different places, merged/)).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Merge changes' }) as HTMLInputElement).checked).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resolve reviewed fork' })); });
    await screen.findByText(/stays in history/);
    fireEvent.click(screen.getByRole('button', { name: 'Open history' }));
    expect(opened).toBe(true);
  });

  it('offers only Keep mine and Use theirs when no merge is available and requires an explicit pick', async () => {
    const { doc, harness } = fixture();
    const api = (globalThis as any).__ZCC_PLUGIN_RUNTIME__.useRpc();
    const call = api.call.bind(api);
    const original = await harness.call('peerConflictReview', { doc: doc.id, remoteHead: 'remote-head' }) as object;
    api.call = (method: string, args: unknown) => method === 'peerConflictReview'
      ? Promise.resolve({ ...original, questions: [], settled: [], mergeAvailable: false, conflicts: ['common ancestor unavailable'] }) : call(method, args);
    harness.render(<PeerConflictView docId={doc.id} onClose={() => {}} />);
    await screen.findByText('common ancestor unavailable');
    expect(screen.queryByRole('radio', { name: 'Merge changes' })).toBeNull();
    const resolve = screen.getByRole('button', { name: 'Resolve reviewed fork' });
    expect(resolve).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('radio', { name: 'Keep mine' }));
    await act(async () => { fireEvent.click(resolve); });
    await screen.findByText('No unresolved peer forks.');
    expect(harness.rpcCalls.find((call) => call.method === 'resolvePeerConflict')?.input).toMatchObject({ choice: 'local' });
  });

  it('shows binary files without a diff and still requires a choice', async () => {
    const { doc, harness } = fixture(true);
    const api = (globalThis as any).__ZCC_PLUGIN_RUNTIME__.useRpc();
    const call = api.call.bind(api);
    const file = await harness.call('peerConflictFile', { doc: doc.id, remoteHead: 'remote-head', path: 'README.md' }) as any;
    const variant: any = { ...file, local: { content: 'AAAA', encoding: 'base64' } };
    api.call = (method: string, args: unknown) => method === 'peerConflictFile' ? Promise.resolve(variant) : call(method, args);
    harness.render(<PeerConflictView docId={doc.id} onClose={() => {}} />);
    await screen.findByText(/Binary file/);
    expect(screen.getByRole('button', { name: 'Resolve reviewed fork' })).toHaveProperty('disabled', true);
  });

  it.each(['peerConflicts', 'peerConflictReview', 'peerConflictFile'])('shows %s errors without resolving or changing fork', async (method) => {
    const { doc, harness, sync } = fixture(true);
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

  it('blocks resolve and offers rereview when a file response comes from a newer head than the review', async () => {
    const { doc, harness } = fixture(true);
    const file = await harness.call('peerConflictFile', { doc: doc.id, remoteHead: 'remote-head', path: 'README.md' });
    const api = (globalThis as any).__ZCC_PLUGIN_RUNTIME__.useRpc();
    const call = api.call.bind(api);
    api.call = (method: string, args: unknown) => method === 'peerConflictFile' ? Promise.resolve({ ...(file as object), localHead: 'newer-head' }) : call(method, args);
    harness.render(<PeerConflictView docId={doc.id} onClose={() => {}} />);
    await screen.findByText(/head changed/i);
    fireEvent.click(await screen.findByRole('radio', { name: 'Keep mine' }));
    expect(screen.getByRole('button', { name: 'Resolve reviewed fork' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Review again' })).toBeTruthy();
  });
});
