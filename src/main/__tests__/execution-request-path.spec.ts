import { describe, expect, it } from 'vitest';
import { lstat, mkdtemp, mkdir, open, readFile, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStartRequestFile } from '../execution-mcp-tool.js';

describe('readStartRequestFile requestPath lifecycle', () => {
  it('consumes and deletes a valid request file within trusted root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zcc-execution-root-'));
    const requestsDir = join(root, 'execution-requests');
    await mkdir(requestsDir, { recursive: true });

    const filePath = join(requestsDir, 'request.json');
    const payload = {
      version: 1,
      teamId: 'team-1',
      launchRequestId: 'request-1',
      slots: [{ initialTask: 'Do work' }]
    };
    await writeFile(filePath, JSON.stringify(payload), 'utf8');

    const result = await readStartRequestFile(filePath, requestsDir);
    expect(result).toEqual(payload);

    await expect(readStartRequestFile(filePath, requestsDir)).rejects.toThrow('requestPath is unavailable');

    await rm(root, { recursive: true, force: true });
  });

  it('rejects malformed JSON and still deletes the file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zcc-execution-malformed-'));
    const requestsDir = join(root, 'execution-requests');
    await mkdir(requestsDir, { recursive: true });

    const filePath = join(requestsDir, 'malformed.json');
    await writeFile(filePath, '{ malformed', 'utf8');

    await expect(readStartRequestFile(filePath, requestsDir)).rejects.toThrow('requestPath must contain valid JSON');

    await expect(readStartRequestFile(filePath, requestsDir)).rejects.toThrow('requestPath is unavailable');

    await rm(root, { recursive: true, force: true });
  });

  it('enforces path confinement (cannot escape trusted root)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zcc-execution-confinement-'));
    const requestsDir = join(root, 'execution-requests');
    await mkdir(requestsDir, { recursive: true });

    const filePath = join(root, 'escaped.json');
    const payload = {
      version: 1,
      teamId: 'team-1',
      launchRequestId: 'request-1',
      slots: [{ initialTask: 'Escape' }]
    };
    await writeFile(filePath, JSON.stringify(payload), 'utf8');

    await expect(readStartRequestFile(filePath, requestsDir)).rejects.toThrow('requestPath must be within the execution request directory');

    await rm(root, { recursive: true, force: true });
  });

  it('rejects relative paths', async () => {
    await expect(readStartRequestFile('relative/path.json')).rejects.toThrow('requestPath must be absolute');
  });

  it('rejects and consumes a symlink without deleting its target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zcc-execution-symlink-'));
    const requestsDir = join(root, 'execution-requests');
    await mkdir(requestsDir, { recursive: true });
    const target = join(requestsDir, 'target.json');
    const requestPath = join(requestsDir, 'request.json');
    await writeFile(target, JSON.stringify({ version: 1, teamId: 'team-1', launchRequestId: 'request-1', slots: [{ initialTask: 'work' }] }));
    await symlink(target, requestPath);

    await expect(readStartRequestFile(requestPath, requestsDir)).rejects.toThrow(
      'requestPath must be a regular file no larger than 8388608 bytes'
    );
    await expect(lstat(requestPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(target, 'utf8')).resolves.toContain('request-1');

    await rm(root, { recursive: true, force: true });
  });

  it('consumes an oversized request without reading it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zcc-execution-oversized-'));
    const requestsDir = join(root, 'execution-requests');
    await mkdir(requestsDir, { recursive: true });
    const requestPath = join(requestsDir, 'request.json');
    await writeFile(requestPath, Buffer.alloc(8 * 1024 * 1024 + 1, 0x20));

    await expect(readStartRequestFile(requestPath, requestsDir)).rejects.toThrow(
      'requestPath must be a regular file no larger than 8388608 bytes'
    );
    await expect(lstat(requestPath)).rejects.toMatchObject({ code: 'ENOENT' });

    await rm(root, { recursive: true, force: true });
  });

  it('does not read or delete a replacement installed after atomic claim', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zcc-execution-race-'));
    const requestsDir = join(root, 'execution-requests');
    await mkdir(requestsDir, { recursive: true });
    const requestPath = join(requestsDir, 'request.json');
    const original = { version: 1 as const, teamId: 'team-1', launchRequestId: 'original', slots: [{ initialTask: 'work' }] };
    const replacement = { ...original, launchRequestId: 'replacement' };
    await writeFile(requestPath, JSON.stringify(original));

    const result = await readStartRequestFile(requestPath, requestsDir, {
      lstat, open, realpath, unlink,
      rename: async (source, destination) => {
        await rename(source, destination);
        await writeFile(requestPath, JSON.stringify(replacement));
      }
    });

    expect(result.launchRequestId).toBe('original');
    await expect(readFile(requestPath, 'utf8')).resolves.toBe(JSON.stringify(replacement));
    await rm(root, { recursive: true, force: true });
  });
});
