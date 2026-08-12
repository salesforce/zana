import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ExtensionEntry } from '@shared/types';
import {
  agentRoutingForSubmission,
  buildLaunchArgs,
  frameworkOptionsFrom,
  isWorktreeEligible,
  launchStatusAccessibility,
  launcherRoutingFromPersona,
  normalizeWorktreeName,
  normalizeWorktreeNameInput,
  resolveWorktreeDefault,
  selectedAvailableFamily,
  worktreeForSubmission
} from '../AgentLauncher.js';

/**
 * `buildLaunchArgs` carries raw prompt intent to main, which resolves the
 * effective provider and owns prompt-to-argv conversion. Empty prompts retain
 * only the profile-label fallback title.
 */
describe('buildLaunchArgs', () => {
  it('keeps the opening prompt raw and derives a title', () => {
    const { prompt, title } = buildLaunchArgs('Clone a repo and report back', 'claude');
    expect(prompt).toBe('Clone a repo and report back');
    expect(title).toBe('Clone a repo and report back');
  });

  it('preserves a dash-leading prompt for main-side argv conversion', () => {
    expect(buildLaunchArgs('--help me understand this repo', 'claude').prompt).toBe(
      '--help me understand this repo'
    );
  });

  it('trims whitespace and truncates long titles to 40 chars + ellipsis', () => {
    const long = 'a'.repeat(60);
    const { prompt, title } = buildLaunchArgs(`   ${long}   `, 'claude');
    expect(prompt).toBe(long);
    expect(title).toBe(`${'a'.repeat(40)}…`);
  });

  it('falls back to the profile label and no args when the prompt is empty', () => {
    expect(buildLaunchArgs('', 'claude --yolo')).toEqual({
      prompt: undefined,
      title: 'claude --yolo'
    });
    expect(buildLaunchArgs('   ', 'claude')).toEqual({
      prompt: undefined,
      title: 'claude'
    });
  });
});

describe('remote launch drops', () => {
  it('uploads dropped files before inserting their remote paths into the prompt', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    expect(source).toContain('window.cc.fs.uploadToRemote(remoteTarget.id, localPath, \'.\')');
    expect(source).toContain('dropResolver={remoteDropResolver}');
    expect(source).toContain('dropResolving');
  });
});

describe('Fix with AI recovery launch', () => {
  it('uses the managed scratch workspace root instead of retrying a failed project cwd', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    const fixWithAi = source.slice(source.indexOf('const fixWithAi = async'));
    expect(fixWithAi).toContain('window.cc.projects.ensureQuickAgent()');
    expect(fixWithAi).toContain("createTerminal(anchor.id, 'claude-yolo'");
    expect(fixWithAi).not.toContain('isolateScratch:');
  });
});

/**
 * `frameworkOptionsFrom` is the decoupling seam for Advanced view: it derives
 * selectable framework presets from installed extension entries generically —
 * core never names a concrete extension (Rule 6). Only enabled extensions with a
 * well-formed `agentPreset` (a non-empty primer) surface, sorted by display
 * label.
 */
function entry(id: string, over: Partial<ExtensionEntry> = {}): ExtensionEntry {
  return {
    id,
    path: `/ext/${id}`,
    manifest: null,
    enabled: true,
    loaded: true,
    mainActive: true,
    consented: true,
    needsConsent: null,
    ...over
  };
}

function withPreset(
  id: string,
  title: string,
  preset: { label?: string; systemPrompt: string } | null,
  over: Partial<ExtensionEntry> = {}
): ExtensionEntry {
  return entry(id, {
    manifest: {
      id,
      title,
      icon: 'Box',
      entry: { renderer: 'r.js' },
      engines: { zccApi: '^1.0.0' },
      agentPreset: preset ?? undefined
    },
    ...over
  });
}

describe('frameworkOptionsFrom', () => {
  it('surfaces only enabled extensions that declare a primer, sorted by label', () => {
    const opts = frameworkOptionsFrom([
      withPreset('zeta', 'Zeta', { label: 'Zeta FW', systemPrompt: 'z' }),
      withPreset('alpha', 'Alpha', { systemPrompt: 'a' }),
      withPreset('no-preset', 'Plain', null)
    ]);
    expect(opts.map((o) => o.id)).toEqual(['alpha', 'zeta']); // 'Alpha' < 'Zeta FW'
    expect(opts[0].preset.systemPrompt).toBe('a');
  });

  it('excludes disabled extensions and manifest-less / primer-less entries', () => {
    const opts = frameworkOptionsFrom([
      withPreset('disabled', 'Disabled', { systemPrompt: 'd' }, { enabled: false }),
      withPreset('empty', 'Empty', { systemPrompt: '' }),
      entry('bare', { manifest: null })
    ]);
    expect(opts).toEqual([]);
  });
});

describe('launcherRoutingFromPersona', () => {
  it('projects structured and legacy pinned Persona values into editable Agent routing', () => {
    expect(launcherRoutingFromPersona({
      id: 'reviewer',
      name: 'Reviewer',
      source: 'user',
      baseProfile: 'claude',
      model: 'opus',
      permissionMode: 'plan'
    })).toEqual({
      claude: { modelTargetId: 'opus', executionState: 'plan' }
    });
  });

  it('keeps native Codex policies and drops empty adapter entries', () => {
    expect(launcherRoutingFromPersona({
      id: 'codex-reviewer',
      name: 'Codex Reviewer',
      source: 'user',
      baseProfile: 'codex',
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: {
          codex: {
            modelTargetId: 'gpt-5-codex',
            compatibility: { codexSandbox: 'read-only', codexApproval: 'on-request' }
          },
          opencode: {}
        }
      }
    })).toEqual({
      codex: {
        modelTargetId: 'gpt-5-codex',
        compatibility: { codexSandbox: 'read-only', codexApproval: 'on-request' }
      }
    });
  });
});

describe('agentRoutingForSubmission', () => {
  const personaSeed = { modelLevel: 'high' as const, executionState: 'accept-edits' as const };

  it('does not submit Persona-seeded values as Agent overrides until an Agent control changes', () => {
    expect(agentRoutingForSubmission(false, 'opencode', personaSeed, {}, false)).toBeUndefined();
    expect(agentRoutingForSubmission(false, 'opencode', personaSeed, {}, true)).toEqual({
      schemaVersion: 1,
      byAdapter: { opencode: personaSeed }
    });
  });
});

describe('structured routing submission', () => {
  it('keeps submission helper inert until controls mark routing dirty', () => {
    expect(agentRoutingForSubmission(true, 'opencode', {}, {
      opencode: { modelTargetId: 'aisuite/gpt-5.6-sol' }
    }, false)).toBeUndefined();
  });
});

describe('additive launch status', () => {
  it('retains an unavailable requested family instead of falling back to another harness', () => {
    const available = [{ id: 'claude' as const, label: 'claude' }];
    expect(selectedAvailableFamily(available, 'cursor')).toBeUndefined();
    expect(selectedAvailableFamily(available, 'claude')).toBe(available[0]);
  });

  it('exposes retained launch status as an assertive atomic alert described by Send', () => {
    expect(launchStatusAccessibility(true)).toEqual({
      status: {
        id: 'agent-launch-status',
        role: 'alert',
        'aria-live': 'assertive',
        'aria-atomic': true
      },
      describedBy: 'agent-launch-status'
    });
    expect(launchStatusAccessibility(false).describedBy).toBeUndefined();
  });
});

describe('worktree launch intent', () => {
  const localProject = {
    id: 'local',
    name: 'Local',
    path: '/repo',
    createdAt: 1,
    lastActiveAt: 1
  };

  it('offers worktrees only for real local projects', () => {
    expect(isWorktreeEligible(localProject, false)).toBe(true);
    expect(isWorktreeEligible({ ...localProject, quickAgent: true }, false)).toBe(false);
    expect(isWorktreeEligible({ ...localProject, remote: { host: 'devbox' } }, false)).toBe(false);
    expect(isWorktreeEligible(null, true)).toBe(false);
  });

  it('submits a stable named intent only for fresh customized eligible launches', () => {
    expect(worktreeForSubmission(true, true, true, 'login_fix')).toEqual({ branch: 'login_fix' });
    expect(worktreeForSubmission(false, true, true, 'login_fix')).toBeUndefined();
    expect(worktreeForSubmission(true, false, true, 'login_fix')).toBeUndefined();
    expect(worktreeForSubmission(true, true, false, 'login_fix')).toBeUndefined();
    expect(worktreeForSubmission(true, true, true, '')).toBeUndefined();
  });

  it('normalizes names for one branch and checkout segment', () => {
    expect(normalizeWorktreeName(' Fix login / OAuth! ')).toBe('fix_login_oauth');
    expect(normalizeWorktreeName('___')).toBe('');
    expect(normalizeWorktreeName('x'.repeat(60))).toBe('x'.repeat(40));
  });

  it('keeps a trailing underscore while the user is still typing', () => {
    expect(normalizeWorktreeNameInput('login_')).toBe('login_');
    expect(normalizeWorktreeNameInput('Login__OAuth')).toBe('login_oauth');
    expect(normalizeWorktreeName('login_')).toBe('login');
  });

  it('uses project override before global default', () => {
    expect(resolveWorktreeDefault(true, false)).toBe(true);
    expect(resolveWorktreeDefault(false, true)).toBe(false);
    expect(resolveWorktreeDefault(true, true)).toBe(true);
    expect(resolveWorktreeDefault(false, false)).toBe(false);
    expect(resolveWorktreeDefault(undefined, true)).toBe(true);
    expect(resolveWorktreeDefault(undefined, false)).toBe(false);
  });

  it('keeps missing-name validation wired to expansion, focus, and accessible error text', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    expect(source).toContain('setAdvanced(true);');
    expect(source).toContain('worktreeNameRef.current?.scrollIntoView');
    expect(source).toContain('worktreeNameRef.current?.focus();');
    expect(source).toContain('aria-invalid={worktreeNameInvalid || undefined}');
    expect(source).toContain("'Worktree name required.'");
  });
});
