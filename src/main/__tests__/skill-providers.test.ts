import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Unit tests for the pluggable skill-provider layer
 * (`../skills/skill-provider.ts` + `../skills/registry.ts`). These exercise the
 * pure discovery/toggle/id logic against temp PROJECT dirs — no `~/.claude`
 * mocking needed, since the project scope reads only from the supplied path.
 *
 * Load-bearing invariants asserted here:
 *  1. Claude Code entry ids stay the historical 2-part `${source}:${qualified}`
 *     shape (existing bundles + skillOverrides references must not break).
 *  2. Non-Claude tools prefix their tool id (`${tool}:${source}:${qualified}`).
 *  3. Cursor `.mdc` rules are discovered and rendered READ-ONLY, with
 *     `alwaysApply` folding into the effective enabled state.
 */

import {
  claudeCodeSkillProvider,
  cursorSkillProvider
} from '../skills/skill-provider.js';
import {
  SKILL_PROVIDERS,
  DEFAULT_SKILL_TOOL,
  entryId,
  providerForEntryId,
  providerForTool
} from '../skills/registry.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-providers-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('registry', () => {
  it('registers Claude Code as the default tool', () => {
    expect(DEFAULT_SKILL_TOOL).toBe('claude-code');
    expect(providerForTool('claude-code')).toBe(claudeCodeSkillProvider);
    expect(providerForTool('cursor')).toBe(cursorSkillProvider);
    expect(providerForTool('nope')).toBeUndefined();
  });

  it('keeps Claude ids 2-part and prefixes every other tool', () => {
    // Claude: byte-identical to the historical id shape.
    expect(entryId('claude-code', 'plugin', 'zana/team-status')).toBe(
      'plugin:zana/team-status'
    );
    expect(entryId('claude-code', 'project', 'my-skill')).toBe('project:my-skill');
    // Cursor (and any future tool): tool-prefixed 3-part.
    expect(entryId('cursor', 'project', 'my-rule')).toBe('cursor:project:my-rule');
  });

  it('resolves a bare 2-part id to Claude and a tool-prefixed id to its tool', () => {
    expect(providerForEntryId('project:my-skill')).toBe(claudeCodeSkillProvider);
    expect(providerForEntryId('plugin:zana/x')).toBe(claudeCodeSkillProvider);
    expect(providerForEntryId('cursor:project:my-rule')).toBe(cursorSkillProvider);
  });
});

describe('claudeCodeSkillProvider', () => {
  it('discovers project skills from .claude/skills and toggles via overrides', async () => {
    const skillDir = join(root, '.claude', 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: My Skill\ndescription: Does a thing\n---\nbody\n'
    );

    const units = await claudeCodeSkillProvider.discover('project', { projectPath: root });
    expect(units).toHaveLength(1);
    expect(units[0].shortName).toBe('My Skill');
    expect(units[0].parsed.description).toBe('Does a thing');

    // Enabled by default; disabled when its short name is in the overrides set.
    expect(claudeCodeSkillProvider.toggleState(units[0], new Set())).toEqual({
      supported: true,
      enabled: true
    });
    expect(claudeCodeSkillProvider.toggleState(units[0], new Set(['My Skill']))).toEqual({
      supported: true,
      enabled: false
    });
  });

  it('returns [] for a scope it does not serve without a project path', async () => {
    expect(await claudeCodeSkillProvider.discover('project', {})).toEqual([]);
  });
});

describe('cursorSkillProvider', () => {
  it('discovers .cursor/rules/*.mdc as read-only, folding alwaysApply', async () => {
    const rulesDir = join(root, '.cursor', 'rules');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(
      join(rulesDir, 'always.mdc'),
      '---\nname: Always Rule\nalwaysApply: true\n---\ncontent\n'
    );
    writeFileSync(
      join(rulesDir, 'conditional.mdc'),
      '---\nname: Conditional Rule\nalwaysApply: false\n---\ncontent\n'
    );

    const units = await cursorSkillProvider.discover('project', { projectPath: root });
    const byName = Object.fromEntries(units.map((u) => [u.shortName, u]));
    expect(Object.keys(byName).sort()).toEqual(['Always Rule', 'Conditional Rule']);

    // alwaysApply:true ⇒ enabled; alwaysApply:false ⇒ not enabled. Both read-only.
    const always = cursorSkillProvider.toggleState(byName['Always Rule'], new Set());
    expect(always.supported).toBe(false);
    expect(always.enabled).toBe(true);

    const conditional = cursorSkillProvider.toggleState(
      byName['Conditional Rule'],
      new Set()
    );
    expect(conditional.supported).toBe(false);
    expect(conditional.enabled).toBe(false);
  });

  it('has no user/plugin scope today', async () => {
    expect(await cursorSkillProvider.discover('user', { projectPath: root })).toEqual([]);
    expect(await cursorSkillProvider.discover('plugin', { projectPath: root })).toEqual([]);
  });
});

describe('SKILL_PROVIDERS registry list', () => {
  it('exposes each provider with a unique id, label, and icon', () => {
    const ids = SKILL_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of SKILL_PROVIDERS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.icon.length).toBeGreaterThan(0);
    }
  });
});
