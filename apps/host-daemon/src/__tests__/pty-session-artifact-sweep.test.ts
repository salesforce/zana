import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('node-pty', () => ({ spawn: () => { throw new Error('not used'); } }));

import { sweepStaleSessionArtifacts } from '../pty.js';

const DAY = 24 * 60 * 60 * 1000;

describe('sweepStaleSessionArtifacts', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pty-sweep-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const age = (path: string, ms: number) => {
    const t = new Date(Date.now() - ms);
    utimesSync(path, t, t);
  };
  const make = (name: string, ageMs: number) => {
    const path = join(dir, name);
    if (name.endsWith('.d')) { mkdirSync(path); writeFileSync(join(path, 'gate.mjs'), 'x'); }
    else writeFileSync(path, 'x');
    age(path, ageMs);
    return path;
  };

  it('removes old orphaned artifacts of every kind', async () => {
    const paths = [
      make('dead.json', 2 * DAY), make('dead.instructions.md', 2 * DAY),
      make('dead.native-tool-gate.mjs', 2 * DAY), make('dead.native-tool-gate.d', 2 * DAY)
    ];
    await sweepStaleSessionArtifacts(dir, Date.now(), () => false);
    for (const path of paths) expect(existsSync(path)).toBe(false);
  });

  it('keeps old artifacts that belong to a live session, including its gate module and dir', async () => {
    const live = [
      make('live.json', 2 * DAY), make('live.native-tool-gate.mjs', 2 * DAY), make('live.native-tool-gate.d', 2 * DAY)
    ];
    const orphan = make('orphan.native-tool-gate.mjs', 2 * DAY);
    await sweepStaleSessionArtifacts(dir, Date.now(), (id) => id === 'live');
    for (const path of live) expect(existsSync(path)).toBe(true);
    expect(existsSync(orphan)).toBe(false);
  });

  it('keeps fresh artifacts and ignores unrelated files', async () => {
    const fresh = make('fresh.json', 1000);
    const other = make('notes.txt', 2 * DAY);
    await sweepStaleSessionArtifacts(dir, Date.now(), () => false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  it('tolerates a missing directory', async () => {
    await expect(sweepStaleSessionArtifacts(join(dir, 'absent'), Date.now(), () => false)).resolves.toBeUndefined();
  });
});
