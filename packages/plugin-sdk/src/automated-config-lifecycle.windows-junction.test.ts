import type * as Fs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConfinedConfigLeaf,
  removeConfinedConfigLeaf,
  sweepConfinedConfigLeaves,
} from './automated-config-lifecycle.js';

/**
 * Emulates, on any OS, the Windows runtime behind #528: `lstat` reports a
 * directory junction as a plain directory, and Electron's recursive `rmSync`
 * (libc++ `remove_all`) walks into it and deletes the target's contents.
 */
const windows = vi.hoisted(() => ({ linksLookLikeDirectories: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  const lstatSync = ((path: Fs.PathLike, options?: Fs.StatSyncOptions) => {
    const stat = actual.lstatSync(path, options);
    if (!windows.linksLookLikeDirectories || !stat?.isSymbolicLink()) return stat;
    return { isSymbolicLink: () => false, isDirectory: () => true };
  }) as typeof actual.lstatSync;
  const rmSync = ((path: Fs.PathLike, options?: Fs.RmOptions) => {
    if (!windows.linksLookLikeDirectories || options?.recursive !== true) {
      actual.rmSync(path, options);
      return;
    }
    const walk = (entry: string): void => {
      const stat = actual.statSync(entry, { throwIfNoEntry: false });
      if (stat === undefined) return;
      if (!stat.isDirectory()) {
        actual.unlinkSync(entry);
        return;
      }
      for (const name of actual.readdirSync(entry)) walk(join(entry, name));
      if (actual.lstatSync(entry).isSymbolicLink()) actual.unlinkSync(entry);
      else actual.rmdirSync(entry);
    };
    walk(String(path));
  }) as typeof actual.rmSync;
  return { ...actual, lstatSync, rmSync };
});

describe('automated config leaves on Windows-like runtimes', () => {
  let dataDir: string;
  let transcripts: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'zcc-sdk-config-win-'));
    // Stands in for the user's real `~/.claude/projects`.
    transcripts = join(dataDir, 'user-claude', 'projects');
    mkdirSync(join(transcripts, '-Users-me-repo'), { recursive: true });
    writeFileSync(join(transcripts, '-Users-me-repo', 'session.jsonl'), '{"keep":true}\n');
  });

  afterEach(() => {
    windows.linksLookLikeDirectories = false;
    rmSync(dataDir, { recursive: true, force: true });
  });

  function leafLinkedToTranscripts(ownerId: string): string {
    const leaf = createConfinedConfigLeaf({ dataDir, ownerId, parentName: 'automated-config' });
    symlinkSync(transcripts, join(leaf, 'projects'), 'junction');
    writeFileSync(join(leaf, 'settings.json'), '{}\n');
    return leaf;
  }

  it('removes a leaf without emptying the transcripts its projects link points at', () => {
    const leaf = leafLinkedToTranscripts('owner');
    windows.linksLookLikeDirectories = true;

    removeConfinedConfigLeaf(dataDir, 'automated-config', leaf);

    expect(existsSync(leaf)).toBe(false);
    expect(readFileSync(join(transcripts, '-Users-me-repo', 'session.jsonl'), 'utf8')).toBe('{"keep":true}\n');
  });

  it('sweeps a stale leaf without emptying the linked transcripts', () => {
    const leaf = leafLinkedToTranscripts('stale');
    const old = new Date(Date.now() - 60_000);
    utimesSync(leaf, old, old);
    windows.linksLookLikeDirectories = true;

    const removed = sweepConfinedConfigLeaves({
      dataDir,
      parentName: 'automated-config',
      liveOwnerIds: new Set(),
      ttlMs: 1_000,
    });

    expect(removed).toEqual(['stale']);
    expect(existsSync(leaf)).toBe(false);
    expect(existsSync(join(transcripts, '-Users-me-repo', 'session.jsonl'))).toBe(true);
  });
});
