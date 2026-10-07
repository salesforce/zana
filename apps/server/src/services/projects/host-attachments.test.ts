import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@zana-ai/zcc-db', () => ({ getPrimaryHost: () => ({ id: 'primary' }) }));

const { attachmentPathResolverForHost } = await import('./host-attachments.js');
const { storeAttachment } = await import('./attachments.js');

const REMOTE_DATA_DIR = '/home/me/.zcc';
let dir: string;
let calls: Array<{ hostId: string; command: Record<string, unknown> }>;
let writeResult: (command: Record<string, unknown>) => unknown;

function context() {
  return {
    dataDir: dir,
    db: {} as never,
    hostHub: {
      callHostOnlineRpc: vi.fn(async ({ hostId, command }: { hostId: string; command: Record<string, unknown> }) => {
        calls.push({ hostId, command });
        if (command.type === 'project.clone_default_path') return { path: `${REMOTE_DATA_DIR}/checkouts/${String(command.projectSlug)}` };
        return writeResult(command);
      })
    } as never
  };
}

const upload = (name = 'shot.png', bytes = [1, 2, 3]) =>
  storeAttachment(dir, 'p1', { name, type: 'image/png', size: bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'host-attachments-'));
  calls = [];
  writeResult = () => ({ outcome: 'written', sha256: 'x', sizeBytes: 3 });
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('attachmentPathResolverForHost', () => {
  it('resolves to the server data dir on the primary host without any RPC', async () => {
    const stored = await upload();
    const resolve = await attachmentPathResolverForHost(context(), { hostId: 'primary', projectId: 'p1', input: [stored] });
    expect(resolve(stored.path)).toBe(join(dir, 'attachments', 'p1', stored.path));
    expect(calls).toEqual([]);
  });

  it('skips the remote probe when the prompt carries no stored attachments', async () => {
    const resolve = await attachmentPathResolverForHost(context(), {
      hostId: 'remote', projectId: 'p1',
      input: [{ type: 'text', text: 'hi', mentions: [] }, { type: 'localImage', path: '/abs/on/remote.png' }]
    });
    expect(resolve('/abs/on/remote.png')).toBe('/abs/on/remote.png');
    expect(calls).toEqual([]);
  });

  it('copies stored attachments into the remote data dir once and resolves prompt paths there', async () => {
    const stored = await upload();
    const resolve = await attachmentPathResolverForHost(context(), { hostId: 'remote', projectId: 'p1', input: [stored, stored, 'legacy'] });
    const target = `${REMOTE_DATA_DIR}/attachments/p1/${stored.path}`;
    expect(resolve(stored.path)).toBe(target);
    const writes = calls.filter((call) => call.command.type === 'host.write_file');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({
      hostId: 'remote',
      command: {
        type: 'host.write_file', path: target, rootPath: REMOTE_DATA_DIR,
        content: Buffer.from([1, 2, 3]).toString('base64'), contentEncoding: 'base64',
        createParents: true, expectedSha256: null, mode: 0o600
      }
    });
  });

  it('accepts an identical file already on the remote but rejects a different one', async () => {
    const stored = await upload();
    writeResult = () => ({ outcome: 'conflict', currentSha256: createHash('sha256').update(Buffer.from([1, 2, 3])).digest('hex') });
    const resolve = await attachmentPathResolverForHost(context(), { hostId: 'remote', projectId: 'p1', input: [stored] });
    expect(resolve(stored.path)).toBe(`${REMOTE_DATA_DIR}/attachments/p1/${stored.path}`);
    writeResult = () => ({ outcome: 'conflict', currentSha256: 'other' });
    await expect(attachmentPathResolverForHost(context(), { hostId: 'remote', projectId: 'p1', input: [stored] }))
      .rejects.toMatchObject({ code: 'attachment-stage-failed' });
  });

  it('surfaces probe and write failures as attachment-stage-failed', async () => {
    const stored = await upload();
    writeResult = () => { throw new Error('too_large'); };
    await expect(attachmentPathResolverForHost(context(), { hostId: 'remote', projectId: 'p1', input: [stored] }))
      .rejects.toMatchObject({ status: 502, code: 'attachment-stage-failed', message: expect.stringContaining('too_large') });
    const ctx = context();
    (ctx.hostHub as { callHostOnlineRpc: unknown }).callHostOnlineRpc = async () => { throw new Error('offline'); };
    await expect(attachmentPathResolverForHost(ctx, { hostId: 'remote', projectId: 'p1', input: [stored] }))
      .rejects.toMatchObject({ code: 'attachment-stage-failed', message: expect.stringContaining('offline') });
  });

  it('rejects missing, traversal and symlink-escaping attachment paths', async () => {
    await upload();
    const outside = join(dir, 'outside');
    await writeFile(outside, 'secret');
    await symlink(outside, join(dir, 'attachments', 'p1', 'link.png'));
    for (const path of ['missing.png', '../outside', 'link.png']) {
      await expect(attachmentPathResolverForHost(context(), { hostId: 'remote', projectId: 'p1', input: [{ type: 'localImage', path }] }))
        .rejects.toThrow();
    }
    expect(calls.filter((call) => call.command.type === 'host.write_file')).toEqual([]);
  });
});
