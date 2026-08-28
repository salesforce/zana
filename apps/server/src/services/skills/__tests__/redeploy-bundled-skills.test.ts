import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * `redeployBundledSkills` copies only `zcc-cli` into `~/.claude/skills`.
 * Other product skills are injected from builtin-skills at thread spawn.
 */
const testHome = join(tmpdir(), `redeploy-skills-test-${process.pid}`);

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => join(tmpdir(), `redeploy-skills-test-${process.pid}`)
  };
});

// eslint-disable-next-line import/first
import { redeployBundledSkills, BUNDLED_SKILL_NAMES } from '../skill-installer.js';

describe('redeployBundledSkills', () => {
  beforeEach(() => {
    rmSync(testHome, { recursive: true, force: true });
  });
  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
  });

  it('deploys only zcc-cli to ~/.claude/skills and reports a per-skill outcome', async () => {
    const results = await redeployBundledSkills();
    expect(BUNDLED_SKILL_NAMES).toEqual(['zcc-cli']);
    expect(results.map((r) => r.name)).toEqual(['zcc-cli']);
    expect(results[0]?.ok).toBe(true);
    const skillFile = join(testHome, '.claude', 'skills', 'zcc-cli', 'SKILL.md');
    expect(existsSync(skillFile)).toBe(true);
    expect(readFileSync(skillFile, 'utf-8')).toMatch(/zcc thread spawn/);
    expect(existsSync(join(testHome, '.claude', 'skills', 'zcc-plugin-authoring', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(testHome, '.claude', 'skills', 'harness-authoring', 'SKILL.md'))).toBe(false);
  });

  it('is idempotent — a second run leaves the files and still reports ok', async () => {
    const first = await redeployBundledSkills();
    expect(first.every((r) => r.ok)).toBe(true);
    const second = await redeployBundledSkills();
    expect(second.every((r) => r.ok)).toBe(true);
    expect(second.length).toBe(first.length);
  });
});
