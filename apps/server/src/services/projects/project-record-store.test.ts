import { describe, expect, it, vi } from 'vitest';
import type { FollowUp, Project } from '@zana-ai/zcc-domain/product';
import type { ProjectMetadataRequest, ProjectMetadataResult } from '@zana-ai/zcc-contracts/project-metadata-records';
import { ProjectRecordStore } from './project-record-store.js';
import { validateFollowUpFile } from '../followups/followup-validation.js';

const record = (patch: Partial<FollowUp> = {}): FollowUp => ({ id: 'f', projectId: 'foreign', title: 'Question', kind: 'question', status: 'open', origin: { source: 'user' }, createdAt: '2026-09-29', updatedAt: '2026-09-29', source: { projectId: 'foreign' }, ...patch });
const project = (id: string, hostId?: string): Project => ({ id, hostId, path: `/same/${id}`, name: id, createdAt: 0, lastActiveAt: 0 });
function fixture() {
  const projects = [project('local', 'a'), project('legacy'), project('foreign', 'b')];
  const local = { list: vi.fn((): FollowUp[] => []), save: vi.fn(), remove: vi.fn(() => true) };
  const request = vi.fn(async (r: ProjectMetadataRequest): Promise<ProjectMetadataResult> => ({ projectId: r.projectId, kind: r.kind, hostId: 'b', records: r.action === 'remove' ? [] : [{ id: 'f', content: r.action === 'write' ? r.content : JSON.stringify(record()), sha256: r.action === 'write' ? 'new-revision' : 'revision' }] }));
  const log = vi.fn();
  const store = new ProjectRecordStore({ kind: 'followups', projects: () => projects, primaryHostId: () => 'a', request, validate: validateFollowUpFile, local, log });
  return { store, projects, local, request, log };
}

describe('original-owner record persistence', () => {
  it('reads only primary-owned paths locally and stamps the foreign scope', async () => {
    const { store, local, request } = fixture();
    expect(store.localProjects().map(p => p.id)).toEqual(['local', 'legacy']);
    expect(await store.load()).toEqual([record()]);
    expect(local.list.mock.calls[0][0].map(p => p.id)).toEqual(['local', 'legacy']);
    expect(request).toHaveBeenCalledWith({ action: 'list', kind: 'followups', projectId: 'foreign' });
  });
  it('keeps the last snapshot on failed refresh and removes a forgotten project', async () => {
    const { store, request, projects, log } = fixture();
    await store.load(); request.mockRejectedValue(new Error('offline'));
    expect(await store.load()).toEqual([record()]); expect(log).toHaveBeenCalledWith('foreign', expect.any(Error));
    projects.pop(); expect(await store.load()).toEqual([]);
  });
  it('uses exact revisions, strips transient source and commits only after an acknowledged write', async () => {
    const { store, request, local } = fixture(); await store.load();
    request.mockRejectedValueOnce(new Error('conflict'));
    await expect(store.save(record({ title: 'New' }))).rejects.toThrow('conflict');
    await store.save(record({ title: 'New' }));
    const write = request.mock.calls.at(-1)![0]; expect(write).toMatchObject({ action: 'write', expectedSha256: 'revision', projectId: 'foreign' });
    expect(JSON.parse((write as { content: string }).content)).not.toHaveProperty('source');
    await store.save(record({ title: 'Newer' })); expect(request.mock.calls.at(-1)![0]).toMatchObject({ expectedSha256: 'new-revision' });
    expect(local.save).not.toHaveBeenCalled();
  });
  it('new foreign records require absence, and successful removal clears their snapshot', async () => {
    const { store, request } = fixture();
    await store.save(record()); expect(request.mock.calls[0][0]).toMatchObject({ expectedSha256: null });
    await store.remove(record()); expect(request.mock.calls.at(-1)![0]).toMatchObject({ action: 'remove', expectedSha256: 'new-revision' });
    request.mockRejectedValue(new Error('offline')); expect(await store.load()).toEqual([]);
    await expect(store.remove(record())).rejects.toThrow('revision is unavailable');
  });
  it('failed removal preserves revision and snapshot', async () => {
    const { store, request } = fixture(); await store.load();
    request.mockRejectedValue(new Error('offline')); await expect(store.remove(record())).rejects.toThrow('offline');
    expect(await store.load()).toEqual([record()]);
  });
  it('keeps global and local project records on the primary and rejects wrong scopes', async () => {
    const { store, local, request, projects } = fixture();
    for (const value of [record({ source: 'global' }), record({ source: undefined }), record({ projectId: 'local', source: { projectId: 'local' } })]) {
      await store.save(value); await store.remove(value);
    }
    expect(local.save).toHaveBeenCalledTimes(3); expect(local.remove).toHaveBeenCalledTimes(3); expect(request).not.toHaveBeenCalled();
    local.remove.mockReturnValue(false); await expect(store.remove(record({ source: 'global' }))).rejects.toThrow('could not be removed');
    await expect(store.save(record({ source: { projectId: 'other' } }))).rejects.toThrow('scope mismatch');
    projects.pop(); await expect(store.save(record())).rejects.toThrow('Unknown metadata project');
  });
  it.each(['scope', 'kind', 'invalid', 'identity', 'duplicate', 'json'])('preserves an existing snapshot after an invalid %s refresh', async problem => {
    const { store, request, log } = fixture(); await store.load();
    const result: ProjectMetadataResult = { projectId: 'foreign', kind: 'followups', hostId: 'b', records: [{ id: 'f', content: JSON.stringify(record()), sha256: 'revision' }] };
    if (problem === 'scope') result.projectId = 'other';
    if (problem === 'kind') result.kind = 'goals';
    if (problem === 'invalid') result.records[0].content = '{}';
    if (problem === 'identity') result.records[0].id = 'other';
    if (problem === 'duplicate') result.records.push(result.records[0]);
    if (problem === 'json') result.records[0].content = '{';
    request.mockResolvedValue(result); expect(await store.load()).toEqual([record()]); expect(log).toHaveBeenCalled();
  });
  it('rejects duplicate identities across stores and malformed write acknowledgements', async () => {
    const { store, local, request } = fixture(); local.list.mockReturnValue([record({ source: 'global' })]);
    await expect(store.load()).rejects.toThrow('Duplicate metadata');
    request.mockResolvedValue({ projectId: 'other', kind: 'followups', hostId: 'b', records: [] });
    await expect(store.save(record())).rejects.toThrow('write response mismatch');
  });
});

it('bounds aggregate refresh time and outstanding reads, rotates hosts, and discards late snapshots', async () => {
  vi.useFakeTimers();
  try {
    const { store, projects, request, log } = fixture();
    await store.load();
    for (let i = 0; i < 9; i++) projects.push(project(`remote-${i}`, 'b'));
    const pending: { request: ProjectMetadataRequest; resolve: (result: ProjectMetadataResult) => void }[] = [];
    request.mockImplementation(r => new Promise(resolve => pending.push({ request: r, resolve })));
    const refresh = store.load(); await vi.advanceTimersByTimeAsync(15_000);
    expect(await refresh).toEqual([record()]); expect(pending).toHaveLength(4); expect(log).toHaveBeenCalledTimes(4);
    // Timed-out reads still consume capacity until the host bridge settles them.
    expect(await store.load()).toEqual([record()]); expect(pending).toHaveLength(4);
    // A newer acknowledged write must never be overwritten by a late list reply.
    request.mockImplementation(async r => ({ projectId: r.projectId, kind: r.kind, hostId: 'b', records: r.action === 'write' ? [{ id: r.id, content: r.content, sha256: 'fresh' }] : [] }));
    await store.save(record({ title: 'Newer commit' }));
    for (const waiting of pending) waiting.resolve({ projectId: waiting.request.projectId, kind: 'followups', hostId: 'b', records: [] });
    await vi.advanceTimersByTimeAsync(0);
    request.mockRejectedValue(new Error('offline'));
    expect(await store.load()).toEqual([record({ title: 'Newer commit' })]);
    const listCalls = request.mock.calls.filter(([r]) => r.action === 'list');
    expect(listCalls[5][0].projectId).toBe('remote-3');
  } finally { vi.useRealTimers(); }
});

describe('explicit original-owner reads', () => {
  it('reads current foreign content and updates the revision used by the next write', async () => {
    const { store, request } = fixture();
    const latest = record({ title: 'Disk edit' });
    request.mockResolvedValueOnce({ projectId: 'foreign', kind: 'followups', hostId: 'b', records: [{ id: 'f', content: JSON.stringify(latest), sha256: 'edited' }] });
    expect(await store.read(record())).toEqual(latest);
    await store.save(latest); expect(request.mock.calls.at(-1)![0]).toMatchObject({ action: 'write', expectedSha256: 'edited' });
  });
  it('requires an owner response rather than returning a cached record', async () => {
    const { store, request } = fixture(); await store.load(); request.mockRejectedValue(new Error('offline'));
    await expect(store.read(record())).rejects.toThrow('offline');
  });
  it.each(['scope', 'kind', 'missing', 'invalid', 'identity'])('rejects an invalid explicit %s read', async problem => {
    const { store, request } = fixture();
    const result: ProjectMetadataResult = { projectId: 'foreign', kind: 'followups', hostId: 'b', records: [{ id: 'f', content: JSON.stringify(record()), sha256: 'revision' }] };
    if (problem === 'scope') result.projectId = 'other';
    if (problem === 'kind') result.kind = 'goals';
    if (problem === 'missing') result.records = [];
    if (problem === 'invalid') result.records[0].content = '{}';
    if (problem === 'identity') result.records[0].content = JSON.stringify(record({ id: 'wrong' }));
    request.mockResolvedValue(result); await expect(store.read(record())).rejects.toThrow();
  });
  it('reads local records through their adapter and forwards explicit definition patches', async () => {
    const { store, local, request } = fixture(); const value = record({ source: 'global' });
    local.list.mockReturnValue([value]); expect(await store.read(value)).toEqual(value);
    const patch = { title: 'Patched' }; await store.save(value, patch);
    expect(local.save).toHaveBeenCalledWith(value, store.localProjects(), patch); expect(request).not.toHaveBeenCalled();
    local.list.mockReturnValue([]); await expect(store.read(value)).rejects.toThrow('not found');
  });
});
