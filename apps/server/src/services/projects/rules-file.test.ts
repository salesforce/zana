import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testHome = join(tmpdir(), `rules-file-test-${Date.now()}`);
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return testHome;
      throw new Error(`Unexpected getPath('${name}')`);
    }
  }
}));

import {
  readGlobalRules,
  readProjectRules,
  composeRulesGuidance,
  resolveRulesGuidance,
  RULES_MAX_BYTES,
  RULES_FILENAME
} from './rules-file.js';

describe('rules-file (WARP-C5)', () => {
  const globalDir = join(testHome, '.zcc');
  const projectRoot = join(testHome, 'proj');
  const projectZcc = join(projectRoot, '.zcc');

  const writeGlobal = (text: string) => {
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, RULES_FILENAME), text);
  };
  const writeProject = (text: string) => {
    mkdirSync(projectZcc, { recursive: true });
    writeFileSync(join(projectZcc, RULES_FILENAME), text);
  };

  beforeEach(() => {
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
    mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
  });

  it('reads a global RULES.md and trims it', () => {
    writeGlobal('  Always run the linter.  \n');
    expect(readGlobalRules()).toBe('Always run the linter.');
  });

  it('reads a project RULES.md confined to the project root', () => {
    writeProject('Never touch src/legacy.');
    expect(readProjectRules(projectRoot)).toBe('Never touch src/legacy.');
  });

  it('returns null when a rules file is absent or empty', () => {
    expect(readGlobalRules()).toBeNull();
    expect(readProjectRules(projectRoot)).toBeNull();
    writeProject('   \n  ');
    expect(readProjectRules(projectRoot)).toBeNull();
  });

  it('skips an oversized rules file rather than truncating', () => {
    writeProject('x'.repeat(RULES_MAX_BYTES + 1));
    expect(readProjectRules(projectRoot)).toBeNull();
  });

  it('refuses a project rules path that symlinks out of the project root (Rule 2)', () => {
    // Plant a real secret outside the project, then point <root>/.zcc at a dir
    // containing a RULES.md that lives outside the project.
    const outside = join(testHome, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, RULES_FILENAME), 'exfiltrate me');
    try {
      symlinkSync(outside, projectZcc, 'dir');
    } catch {
      // Some CI filesystems disallow symlinks; skip the escape assertion there.
      return;
    }
    expect(readProjectRules(projectRoot)).toBeNull();
  });

  it('composes both scopes with project rules last, and null when both empty', () => {
    expect(composeRulesGuidance(null, null)).toBeNull();
    const both = composeRulesGuidance('G-RULE', 'P-RULE');
    expect(both).toContain('G-RULE');
    expect(both).toContain('P-RULE');
    expect(both!.indexOf('P-RULE')).toBeGreaterThan(both!.indexOf('G-RULE'));
    const globalOnly = composeRulesGuidance('G-RULE', null);
    expect(globalOnly).toContain('G-RULE');
    expect(globalOnly).not.toContain('PROJECT RULES');
  });

  it('resolveRulesGuidance layers global + project from disk', () => {
    writeGlobal('global rule');
    writeProject('project rule');
    const out = resolveRulesGuidance(projectRoot);
    expect(out).toContain('global rule');
    expect(out).toContain('project rule');
  });

  it('resolveRulesGuidance returns null when nothing exists', () => {
    expect(resolveRulesGuidance(projectRoot)).toBeNull();
    expect(resolveRulesGuidance(undefined)).toBeNull();
  });

  it('resolveRulesGuidance with only a global file (no project root) still injects', () => {
    writeGlobal('global only');
    const out = resolveRulesGuidance(undefined);
    expect(out).toContain('global only');
  });
});
