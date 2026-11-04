// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UI_USER } from '../server/rpc.js';
import { DocHeader } from './DocHeader.js';
import { ProjectTab } from './slots.js';
import { createHarness } from './test-harness.js';
import { needsAttention, SYNC_STATE_HELP, SYNC_STATE_LABEL, syncResultMessage } from './sync-status.js';
import type { DocSyncState } from './api.js';

const result = (over: Partial<Parameters<typeof syncResultMessage>[0]> = {}) => ({ attempted: 0, synced: 0, blocked: 0, waiting: 0, needsChoice: 0, failed: 0, ...over });

describe('syncResultMessage', () => {
  it('says synced, or already up to date', () => {
    expect(syncResultMessage(result({ attempted: 2, synced: 2 }))).toEqual({ text: 'Synced with your other computers', kind: 'info' });
    expect(syncResultMessage(result())).toEqual({ text: 'Already up to date', kind: 'info' });
  });
  it('explains each problem without the word blocked, desktop or laptop', () => {
    const waiting = syncResultMessage(result({ attempted: 2, synced: 1, blocked: 1, waiting: 1 }));
    expect(waiting).toEqual({ text: 'Synced 1. Some changes are waiting for another computer. They will send on their own.', kind: 'info' });
    expect(syncResultMessage(result({ blocked: 1, needsChoice: 1 })).text).toMatch(/changed on two computers.*choose which version/i);
    const failed = syncResultMessage(result({ blocked: 2, failed: 1, waiting: 1 }));
    expect(failed.kind).toBe('error');
    for (const { text } of [waiting, failed]) expect(text).not.toMatch(/blocked|desktop|laptop/i);
  });
  it('treats a total-only result from an older server as waiting', () => {
    expect(syncResultMessage({ attempted: 1, synced: 0, blocked: 1 }).text).toMatch(/waiting for another computer/);
  });
  it('labels every state in plain words', () => {
    for (const state of Object.keys(SYNC_STATE_LABEL) as DocSyncState[]) {
      expect(`${SYNC_STATE_LABEL[state]} ${SYNC_STATE_HELP[state]}`).not.toMatch(/blocked|desktop|laptop/i);
    }
    expect(['waiting', 'needs-choice', 'failed'].every((s) => needsAttention(s as DocSyncState))).toBe(true);
    expect([undefined, 'up-to-date', 'unsent'].some((s) => needsAttention(s as DocSyncState | undefined))).toBe(false);
  });
});

describe('doc sync status in the UI', () => {
  it('header shows nothing when sync is not set up', async () => {
    const harness = createHarness();
    const doc = harness.store.create({ title: 'Solo', template: 'blank' }, UI_USER);
    harness.render(<DocHeader doc={doc} projects={[]} compact={false} onDeleted={() => undefined} />);
    await waitFor(() => expect(harness.rpcCalls.some((call) => call.method === 'docSyncStatuses')).toBe(true));
    expect(screen.queryByRole('button', { name: /Synced|Waiting|Changed on two|Couldn't send|Not sent/ })).toBeNull();
  });

  it('header shows the state, opens an explanation, and offers the conflict dialog for a two-computer edit', async () => {
    const base = createHarness();
    const doc = base.store.create({ title: 'Clash', template: 'blank' }, UI_USER);
    const state = { current: 'needs-choice' as DocSyncState };
    const stub = { docSyncStatuses: () => [{ docId: doc.id, state: state.current, computers: 1 }] } as never;
    const withStub = createHarness({ store: base.store, peerSync: stub });
    withStub.render(<DocHeader doc={doc} projects={[]} compact={false} onDeleted={() => undefined} />);
    const line = await screen.findByRole('button', { name: /Changed on two computers/ });
    fireEvent.click(line);
    expect(screen.getByRole('dialog', { name: 'Sync status' }).textContent).toMatch(/choose which version to keep/);
    fireEvent.click(screen.getByRole('button', { name: 'Choose a version' }));
    expect(await screen.findByRole('dialog', { name: 'Peer conflicts' })).toBeTruthy();
  });

  it('header explains a waiting doc without a conflict button', async () => {
    const base = createHarness();
    const doc = base.store.create({ title: 'Slow', template: 'blank' }, UI_USER);
    const stub = { docSyncStatuses: () => [{ docId: doc.id, state: 'waiting', computers: 1 }] } as never;
    const h2 = createHarness({ store: base.store, peerSync: stub });
    h2.render(<DocHeader doc={doc} projects={[]} compact={false} onDeleted={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: /Waiting for another computer/ }));
    expect(screen.getByRole('dialog', { name: 'Sync status' }).textContent).toMatch(/send automatically/);
    expect(screen.queryByRole('button', { name: 'Choose a version' })).toBeNull();
  });

  it('list marks only docs that need attention', async () => {
    const base = createHarness();
    const bad = base.store.create({ title: 'Needs attention', projectId: 'p1', template: 'blank' }, UI_USER);
    const fine = base.store.create({ title: 'All good', projectId: 'p1', template: 'blank' }, UI_USER);
    const quiet = base.store.create({ title: 'Not shared', projectId: 'p1', template: 'blank' }, UI_USER);
    const stub = { docSyncStatuses: () => [
      { docId: bad.id, state: 'failed', computers: 1 }, { docId: fine.id, state: 'up-to-date', computers: 0 }, { docId: quiet.id, state: 'unsent', computers: 1 }
    ] } as never;
    const harness = createHarness({ store: base.store, peerSync: stub });
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    const dot = await screen.findByRole('img', { name: "Couldn't send" });
    expect(dot.closest('button')?.textContent).toMatch(/Needs attention/);
    expect(screen.getAllByRole('img', { name: /Synced|Not sent|Waiting|Changed on two|Couldn't send/ })).toHaveLength(1);
  });
});
