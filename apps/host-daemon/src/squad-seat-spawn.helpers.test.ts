import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertRemoteSeatContract, prepareSeatSpawn, shimFirstPath, sweepStaleSeatRoots, trustedSeatParent } from './squad-seat-spawn.js';
import type { SquadSeatCapability } from './harness/launch-provider.js';

/** Helpers behind PtyManager's Squad seat handling (#675) that the spawn tests only reach through a whole launch. */

const cap = (over: Partial<SquadSeatCapability> = {}): SquadSeatCapability =>
  ({ instructions: true, commandDeny: 'shim', executionTools: true, foldPersonaIntoGuidance: false, ...over });
const bases: string[] = [];
const base = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seat-helpers-'));
  bases.push(dir);
  return dir;
};
afterEach(() => {
  while (bases.length > 0) rmSync(bases.pop()!, { recursive: true, force: true });
});

describe('prepareSeatSpawn', () => {
  it('returns nothing without a persona, for a native harness, or with nothing to enforce', () => {
    const baseDir = base();
    expect(prepareSeatSpawn({ capability: cap(), persona: undefined, harnessCommand: 'opencode', baseDir })).toBeUndefined();
    expect(prepareSeatSpawn({ capability: cap({ commandDeny: 'native' }), persona: { appendSystemPrompt: 'x', deniedTools: ['Bash(gh:*)'] }, harnessCommand: 'claude', baseDir })).toBeUndefined();
    expect(prepareSeatSpawn({ capability: cap(), persona: {}, harnessCommand: 'opencode', baseDir })).toBeUndefined();
    expect(readdirSync(baseDir)).toEqual([]);
  });

  it('writes a 0700 shim dir and a 0600 instructions file, and removes both on release (twice is safe)', () => {
    const baseDir = base();
    const plan = prepareSeatSpawn({
      capability: cap(), persona: { appendSystemPrompt: 'ROLE', deniedTools: ['Bash(gh:*)'] }, harnessCommand: '/usr/local/bin/opencode', baseDir
    })!;
    expect((statSync(plan.shimDir!).mode & 0o777).toString(8)).toBe('700');
    expect(readdirSync(plan.shimDir!)).toEqual(['gh']);
    expect((statSync(plan.instructionsFile!).mode & 0o777).toString(8)).toBe('600');
    expect(readFileSync(plan.instructionsFile!, 'utf8')).toContain('ROLE');
    plan.release();
    plan.release();
    expect(readdirSync(baseDir)).toEqual([]);
  });

  it('folds the text into the guidance and writes no file when the harness folds', () => {
    const baseDir = base();
    const plan = prepareSeatSpawn({
      capability: cap({ foldPersonaIntoGuidance: true, commandDeny: 'none' }), persona: { appendSystemPrompt: 'ROLE' }, harnessCommand: 'codex', baseDir
    })!;
    expect(plan.foldIntoGuidance).toBe(true);
    expect(plan.instructionsFile).toBeUndefined();
    expect(plan.shimDir).toBeUndefined();
    expect(plan.instructionsText).toContain('ROLE');
    expect(readdirSync(baseDir)).toEqual([]);
    plan.release();
  });

  it('fails closed when the persona has text a harness cannot carry (restart or restore after a persona edit, A1/F2)', () => {
    const baseDir = base();
    expect(() => prepareSeatSpawn({ capability: cap({ instructions: false }), persona: { appendSystemPrompt: 'ROLE' }, harnessCommand: 'x', baseDir })).toThrow(/cannot carry the persona instructions/);
    expect(() => prepareSeatSpawn({ capability: undefined, persona: { appendSystemPrompt: 'x' }, harnessCommand: 'x', baseDir })).toThrow(/cannot carry/);
    // advisory lines count as text too
    expect(() => prepareSeatSpawn({ capability: cap({ instructions: false, commandDeny: 'none' }), persona: { deniedTools: ['Bash(gh:*)'] }, harnessCommand: 'x', baseDir })).toThrow(/cannot carry/);
    expect(readdirSync(baseDir)).toEqual([]);
  });

  it('fails closed for a harness that can never be a Squad seat (Q3, D7)', () => {
    expect(() => prepareSeatSpawn({ capability: cap(), persona: { appendSystemPrompt: 'ROLE' }, harnessCommand: 'x', baseDir: base(), refusedForSquads: true })).toThrow(/cannot run as a Squad seat/);
  });

  it('makes no shim directory on a harness whose denylist is not shimmed; the deny rides the instructions (decision B, A1)', () => {
    const baseDir = base();
    const plan = prepareSeatSpawn({
      capability: cap({ commandDeny: 'none', foldPersonaIntoGuidance: true }), persona: { appendSystemPrompt: 'ROLE', deniedTools: ['Bash(gh:*)'] }, harnessCommand: 'codex', baseDir
    })!;
    expect(plan.shimDir).toBeUndefined();
    expect(plan.instructionsText).toContain('Bash(gh:*)');
    expect(plan.instructionsText).toContain('not mechanically enforced');
    expect(readdirSync(baseDir)).toEqual([]);
  });

  it('shims the denylist and still carries instructions on a harness whose denylist is shimmed', () => {
    const baseDir = base();
    const plan = prepareSeatSpawn({ capability: cap(), persona: { appendSystemPrompt: 'ROLE', deniedTools: ['Bash(gh:*)'] }, harnessCommand: 'x', baseDir })!;
    expect(plan.shimDir).toBeDefined();
    plan.release();
  });

  it('puts seat roots under one Zana-owned parent and sweeps stale ones by age (A3)', async () => {
    const parent = base();
    const stale = join(parent, 'zcc-seat-old');
    const fresh = join(parent, 'zcc-seat-new');
    const other = join(parent, 'unrelated');
    for (const dir of [stale, fresh, other]) mkdirSync(dir);
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(stale, old, old);
    await sweepStaleSeatRoots(parent, Date.now(), true);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(other)).toBe(true);
    await expect(sweepStaleSeatRoots(join(parent, 'missing'), Date.now(), true)).resolves.toBeUndefined();
  });

  it.skipIf(process.getuid?.() === 0)('logs when a seat root cannot be removed (F6, A5, F18)', () => {
    const baseDir = base();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plan = prepareSeatSpawn({ capability: cap(), persona: { appendSystemPrompt: 'ROLE' }, harnessCommand: 'x', baseDir })!;
    const root = dirname(plan.instructionsFile!);
    // A root whose parent is not writable cannot be emptied by the link-safe remover.
    chmodSync(baseDir, 0o500);
    try {
      plan.release();
      expect(existsSync(root)).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(root), expect.anything());
    } finally {
      chmodSync(baseDir, 0o700);
      warn.mockRestore();
    }
  });

  it('never shadows the harness command, whatever path it is given by', () => {
    const baseDir = base();
    const plan = prepareSeatSpawn({
      capability: cap(), persona: { deniedTools: ['Bash(opencode:*)'] }, harnessCommand: '/opt/bin/opencode', baseDir
    })!;
    // The entry is kept as an advisory line instead of a shim.
    expect(plan.shimDir).toBeUndefined();
    expect(plan.instructionsText).toContain('Bash(opencode:*)');
    plan.release();
  });

  it('removes its directory when writing fails and rethrows', () => {
    const baseDir = base();
    const hostile = 'Bash(' + 'x'.repeat(300) + ':*)';
    expect(() => prepareSeatSpawn({ capability: cap(), persona: { deniedTools: [hostile] }, harnessCommand: 'y', baseDir })).toThrow();
    expect(readdirSync(baseDir)).toEqual([]);
  });
});

describe('seat sweep safety (F12, A9, F15, A8, F20)', () => {
  it('never removes the root of a seat this process still owns, however old', async () => {
    const baseDir = base();
    const plan = prepareSeatSpawn({ capability: cap(), persona: { appendSystemPrompt: 'ROLE' }, harnessCommand: 'x', baseDir })!;
    const root = dirname(plan.instructionsFile!);
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(root, old, old);
    await sweepStaleSeatRoots(baseDir, Date.now(), true);
    expect(existsSync(root)).toBe(true);
    plan.release();
    expect(existsSync(root)).toBe(false);
  });

  it('removes an old orphan root once its owner has released nothing (not tracked)', async () => {
    const parent = base();
    const orphan = join(parent, 'zcc-seat-orphan');
    mkdirSync(orphan);
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(orphan, old, old);
    await sweepStaleSeatRoots(parent, Date.now(), true);
    expect(existsSync(orphan)).toBe(false);
  });

  it('is quiet for a missing parent but warns for any other failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await sweepStaleSeatRoots(join(base(), 'missing'), Date.now(), true);
      expect(warn).not.toHaveBeenCalled();
      const file = join(base(), 'afile');
      writeFileSync(file, 'x');
      await sweepStaleSeatRoots(file, Date.now(), true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('seat sweep failed'), expect.anything());
    } finally {
      warn.mockRestore();
    }
  });

  it('runs one sweep at a time and returns the running one to an overlapping caller', async () => {
    const parent = base();
    const first = sweepStaleSeatRoots(parent, Date.now(), true);
    const second = sweepStaleSeatRoots(parent, Date.now(), true);
    expect(second).toBe(first);
    await first;
  });
});

describe('trustedSeatParent (A7, F13)', () => {
  it('creates a private parent and tightens a loose directory this user owns', () => {
    const dir = join(base(), 'seats');
    expect(trustedSeatParent(dir)).toBe(dir);
    expect((statSync(dir).mode & 0o777).toString(8)).toBe('700');
    chmodSync(dir, 0o777);
    expect(trustedSeatParent(dir)).toBe(dir);
    expect((statSync(dir).mode & 0o777).toString(8)).toBe('700');
  });

  it('refuses a symlinked parent', () => {
    const real = join(base(), 'real');
    mkdirSync(real);
    const link = join(base(), 'link');
    symlinkSync(real, link);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(trustedSeatParent(link)).toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('refuses a directory owned by someone else', () => {
    const dir = join(base(), 'seats');
    mkdirSync(dir);
    const uid = vi.spyOn(process, 'getuid').mockReturnValue(( process.getuid?.() ?? 1000) + 1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(trustedSeatParent(dir)).toBeUndefined();
    } finally {
      uid.mockRestore();
      warn.mockRestore();
    }
  });

  it('refuses a parent that is a file, and warns', () => {
    const file = join(base(), 'afile');
    writeFileSync(file, 'x');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(trustedSeatParent(file)).toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('assertRemoteSeatContract (F10)', () => {
  it('lets a native harness, a persona without text, and an absent persona through', () => {
    expect(() => assertRemoteSeatContract({ capability: cap({ commandDeny: 'native' }), persona: { appendSystemPrompt: 'x' } })).not.toThrow();
    expect(() => assertRemoteSeatContract({ capability: cap(), persona: {} })).not.toThrow();
    expect(() => assertRemoteSeatContract({ capability: cap(), persona: undefined })).not.toThrow();
  });

  it('refuses a remote seat whose persona has instructions or denies a non-native harness cannot carry there', () => {
    expect(() => assertRemoteSeatContract({ capability: cap({ commandDeny: 'none' }), persona: { appendSystemPrompt: 'x' } })).toThrow(/remote project/);
    expect(() => assertRemoteSeatContract({ capability: cap({ commandDeny: 'none' }), persona: { deniedTools: ['Bash(gh:*)'] } })).toThrow(/remote project/);
  });

  it('refuses a harness that can never be a Squad seat', () => {
    expect(() => assertRemoteSeatContract({ capability: cap(), persona: {}, refusedForSquads: true })).toThrow(/cannot run as a Squad seat/);
  });
});

describe('shimFirstPath', () => {
  it('puts the shim directory first, and stands alone when there is no PATH', () => {
    expect(shimFirstPath('/s', '/usr/bin:/bin')).toBe('/s:/usr/bin:/bin');
    expect(shimFirstPath('/s', undefined)).toBe('/s');
    expect(shimFirstPath('/s', '')).toBe('/s');
    expect(existsSync('/s')).toBe(false);
  });
});
