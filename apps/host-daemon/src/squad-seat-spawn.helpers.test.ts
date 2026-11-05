import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareSeatSpawn, shimFirstPath } from './squad-seat-spawn.js';
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
    expect(prepareSeatSpawn({ capability: undefined, persona: { appendSystemPrompt: 'x' }, harnessCommand: 'x', baseDir })).toBeUndefined();
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

  it('does not carry instructions on a harness that cannot, but still shims the denylist', () => {
    const baseDir = base();
    const plan = prepareSeatSpawn({
      capability: cap({ instructions: false }), persona: { appendSystemPrompt: 'ROLE', deniedTools: ['Bash(gh:*)'] }, harnessCommand: 'x', baseDir
    })!;
    expect(plan.instructionsFile).toBeUndefined();
    expect(plan.shimDir).toBeDefined();
    plan.release();
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

describe('shimFirstPath', () => {
  it('puts the shim directory first, and stands alone when there is no PATH', () => {
    expect(shimFirstPath('/s', '/usr/bin:/bin')).toBe('/s:/usr/bin:/bin');
    expect(shimFirstPath('/s', undefined)).toBe('/s');
    expect(shimFirstPath('/s', '')).toBe('/s');
    expect(existsSync('/s')).toBe(false);
  });
});
