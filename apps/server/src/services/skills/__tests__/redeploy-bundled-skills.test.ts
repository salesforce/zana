import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * `redeployBundledSkills` — the roster the boot fan-out AND the "Reload skills &
 * MCP" button both iterate. It must deploy every bundled SKILL.md into
 * `~/.claude/skills/<name>/SKILL.md`, report a per-skill outcome, and be
 * idempotent (a second run over identical on-disk content is a no-op but still
 * reports ok). `homedir()` is mocked to a temp dir so we install into an
 * isolated `~/.claude`; the shipped resources resolve from the repo's real
 * `resources/` (dev path `__dirname/../../resources`).
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

  it('deploys every bundled skill and reports a per-skill outcome', async () => {
    const results = await redeployBundledSkills();
    // One result per roster entry, and the names match the exported roster.
    expect(results.map((r) => r.name).sort()).toEqual([...BUNDLED_SKILL_NAMES].sort());
    const harnessAuthoring = results.find((r) => r.name === 'harness-authoring');
    expect(harnessAuthoring?.ok).toBe(true);
    const skillFile = join(testHome, '.claude', 'skills', 'harness-authoring', 'SKILL.md');
    expect(existsSync(skillFile)).toBe(true);
    expect(readFileSync(skillFile, 'utf-8')).toMatch(/first-party.*coding-agent/i);

    const pluginAuthoring = results.find((r) => r.name === 'zcc-plugin-authoring');
    expect(pluginAuthoring?.ok).toBe(true);
    const pluginAuthoringFile = join(testHome, '.claude', 'skills', 'zcc-plugin-authoring', 'SKILL.md');
    expect(existsSync(pluginAuthoringFile)).toBe(true);
    expect(readFileSync(pluginAuthoringFile, 'utf-8')).toMatch(/zcc plugin new/);

    const browser = results.find((r) => r.name === 'zcc-browser');
    expect(browser?.ok).toBe(true);
    const browserFile = join(testHome, '.claude', 'skills', 'zcc-browser', 'SKILL.md');
    expect(existsSync(browserFile)).toBe(true);
    expect(readFileSync(browserFile, 'utf-8')).toMatch(/browser_open/);
  });

  it('is idempotent — a second run leaves the files and still reports ok', async () => {
    const first = await redeployBundledSkills();
    expect(first.every((r) => r.ok)).toBe(true);
    const second = await redeployBundledSkills();
    expect(second.every((r) => r.ok)).toBe(true);
    // Same roster, same count — no duplication, no drift.
    expect(second.length).toBe(first.length);
  });
});
