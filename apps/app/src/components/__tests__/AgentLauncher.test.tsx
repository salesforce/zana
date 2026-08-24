import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ExtensionEntry } from '@zana-ai/zcc-domain/product';
import { executionMappingOptions } from '@zana-ai/zcc-domain/harness-adapter';
import { appendAttachmentContext, mergeAttachmentPaths } from '../../lib/attachments.js';
import {
  agentRoutingForSubmission,
  buildLaunchArgs,
  discoveryForOpenCodePicker,
  frameworkOptionsFrom,
  isWorktreeEligible,
  launchStatusAccessibility,
  launcherRoutingFromPersona,
  normalizeWorktreeName,
  normalizeWorktreeNameInput,
  roleTargetValueForPicker,
  resolveWorktreeDefault,
  resolveOpenCodeRoleOptions,
  reconcileOpenCodeRole,
  selectedAvailableFamily,
  optionalHarnessOffered,
  worktreeForSubmission,
  workspaceForSubmission
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

describe('launcher attachments', () => {
  it('deduplicates file selections and appends them as launch context', () => {
    expect(mergeAttachmentPaths(['/tmp/one.md'], ['/tmp/one.md', ' /tmp/two.md '])).toEqual([
      '/tmp/one.md',
      '/tmp/two.md'
    ]);
    expect(appendAttachmentContext('Review these', ['/tmp/one.md', '/tmp/two.md'])).toBe(
      'Review these\n\nAttached files:\n- /tmp/one.md\n- /tmp/two.md'
    );
  });

  it('renders removable pills and uploads remote attachments at launch', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    expect(source).toContain('product.fs.uploadToRemote(remoteTarget.id, localPath, \'.\')');
    expect(source).toContain('attachments={attachments}');
    expect(source).toContain('onAddAttachments={addAttachments}');
    expect(source).toContain('appendAttachmentContext(prompt, attachmentPaths)');
  });
});

describe('Quick Agent composer', () => {
  it('uses the Home-style command surface without duplicating launcher pickers', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    expect(source).toContain('const useQuickAgentHomeComposer = scratchIsTarget;');
    expect(source).toContain('product.quickPrompts.list().catch(() => [])');
    expect(source).toContain('product.extensions.list().catch(() => [])');
    expect(source).toContain("variant={useQuickAgentHomeComposer ? 'home' : 'default'}");
    expect(source).toContain("submitLabel={mode === 'autonomous' ? 'Launch autonomous team' : 'Launch agent'}");
    expect(source).toContain("{mode !== 'thread' && !useQuickAgentHomeComposer && (");
    expect(source).toContain("mode === 'autonomous'");
  });
});

describe('launch mode', () => {
  it('offers Thread, Legacy Agent, and Autonomous Team without gating the whole control on teams', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    expect(source).toContain("useState<'thread' | 'agent' | 'autonomous'>('thread')");
    expect(source).toContain('>\n                Thread\n              </button>');
    expect(source).toContain('Legacy Agent');
    expect(source).toContain('Autonomous Team');
    expect(source).not.toContain('Single agent');
    expect(source).toContain('<ThreadCommandComposer');
    expect(source).toContain('initialText={initialPrompt}');
    expect(source).toContain('onCreated={onClose}');
    expect(source).toContain("{mode !== 'thread' && (<>");
    expect(source).toContain('{teams.length > 0 && (');
  });

  it('paints the thread composer on a panel surface distinct from the launch modal', () => {
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    const start = css.indexOf('.launch-modal .thread-command-composer .ui-command-composer {');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('background: var(--bg-panel);');
    expect(block).not.toContain('background: var(--bg-elevated);');
    expect(block).toContain('box-shadow: none;');
  });
});

describe('launcher presentation', () => {
  it('always portals as a modal and has no inline presentation API', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('presentation?:');
    expect(source).not.toMatch(/presentation\s*=/);
    expect(source).toContain('useDialogFocusTrap(dialogRef, onClose)');
    expect(source).toContain('data-testid="launch-modal"');
    expect(source).toContain("className=\"palette launch-modal\"");
    expect(source).toContain('return createPortal(');
    expect(source).toContain('className="palette-backdrop"');
  });

  it('is never mounted with a presentation prop', () => {
    const files = [
      new URL('../AgentLauncher.tsx', import.meta.url),
      new URL('../../App.tsx', import.meta.url),
      new URL('../../views/project/WorkspaceView.tsx', import.meta.url),
      new URL('../../views/agents/AgentsView.tsx', import.meta.url),
      new URL('../../views/agents/AgentsBoard.tsx', import.meta.url),
      new URL('../listpane/AgentsList.tsx', import.meta.url),
      new URL('../InboxDetail.tsx', import.meta.url),
      new URL('../../views/library/LibraryView.tsx', import.meta.url),
      new URL('../../views/library/LibraryPanel.tsx', import.meta.url)
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, file.pathname).not.toMatch(/presentation=/);
    }
  });
});

describe('Fix with AI recovery launch', () => {
  it('uses the managed scratch workspace root instead of retrying a failed project cwd', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    const fixWithAi = source.slice(source.indexOf('const fixWithAi = async'));
    expect(fixWithAi).toContain('product.projects.ensureQuickAgent()');
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

describe('OpenCode project agent discovery', () => {
  it('shows loading instead of another project or profile discovery snapshot', () => {
    expect(discoveryForOpenCodePicker('project-b', 'opencode', {
      projectId: 'project-a',
      profile: 'opencode',
      discovery: { status: 'success', descriptors: [
        { id: 'prior-role', label: 'prior-role', mode: 'primary', hidden: false, directLaunchAllowed: true }
      ] }
    })).toEqual({ status: 'loading' });
    expect(discoveryForOpenCodePicker('project-b', 'opencode', {
      projectId: 'project-b',
      profile: 'opencode-resume',
      discovery: { status: 'failure' }
    })).toEqual({ status: 'loading' });
    expect(discoveryForOpenCodePicker('project-b', 'opencode', {
      projectId: 'project-b',
      profile: 'opencode',
      discovery: { status: 'failure' }
    })).toEqual({ status: 'failure' });
  });

  it('renders only role values valid for the current picker catalog', () => {
    const roles = [{ id: 'review', label: 'Review', scope: ['local'] as ['local'] }];
    expect(roleTargetValueForPicker('build', roles)).toBe('');
    expect(roleTargetValueForPicker('review', roles)).toBe('review');
    expect(roleTargetValueForPicker('review', [])).toBe('');
  });

  it('loads through project-id IPC once, refreshes explicitly, and prevents stale updates', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    expect(source).toContain('product.harness.agentDescriptors(\n      openCodeAgentDiscoveryProjectId,\n      openCodeAgentDiscoveryProfile,\n      agentDescriptorsRefresh > 0\n    )');
    expect(source).toContain('setAgentDescriptorsRefresh((value) => value + 1);');
    expect(source).toContain('Effective OpenCode agent');
    expect(source).toContain('Refresh agents');
    expect(source).toMatch(/return \(\) => \{\s*cancelled = true;\s*\};/);
  });

  it('offers only directly launchable dynamic agents as role targets', () => {
    const staticRoles = [
      { id: 'build', label: 'Build', scope: ['local'] as ['local'] },
      { id: 'plan', label: 'Plan', scope: ['local'] as ['local'] }
    ];
    const mappedRoles = [
      ...staticRoles,
      { id: 'build', label: 'Build', executionStates: ['accept-edits', 'autonomous'] as const, scope: ['local'] as ['local'] }
    ];
    expect(resolveOpenCodeRoleOptions(mappedRoles, { status: 'success', descriptors: [
      { id: 'build', label: 'build', mode: 'subagent', hidden: false, directLaunchAllowed: false },
      { id: 'hidden-system', label: 'hidden-system', mode: 'primary', hidden: true, directLaunchAllowed: false },
      { id: 'build', label: 'build', mode: 'primary', hidden: false, directLaunchAllowed: true },
      { id: 'custom', label: 'custom', mode: 'primary', hidden: false, directLaunchAllowed: true }
    ] })).toEqual([
      { id: 'build', label: 'build [Accept Edits, Autonomous]', scope: ['local'] },
      { id: 'custom', label: 'custom', scope: ['local'] }
    ]);
    expect(resolveOpenCodeRoleOptions(staticRoles, { status: 'success', descriptors: [] })).toEqual([]);
    expect(resolveOpenCodeRoleOptions(staticRoles, { status: 'failure' })).toEqual([]);
  });

  it('combines portable states that share one native execution policy', () => {
    expect(executionMappingOptions({
      plan: 'plan',
      interactive: 'default',
      'accept-edits': 'force',
      autonomous: 'force'
    })).toEqual([
      { id: 'plan', native: 'plan', states: ['plan'] },
      { id: 'interactive', native: 'default', states: ['interactive'] },
      { id: 'accept-edits', native: 'force', states: ['accept-edits', 'autonomous'] },
      { id: 'autonomous', native: 'force', states: ['accept-edits', 'autonomous'] }
    ]);
  });

  it('reconciles selected role against authoritative current discovery state', () => {
    const success = { status: 'success' as const, descriptors: [
      { id: 'custom', label: 'custom', mode: 'all' as const, hidden: false, directLaunchAllowed: true }
    ] };
    expect(reconcileOpenCodeRole('build', success)).toBeUndefined();
    expect(reconcileOpenCodeRole('custom', success)).toBe('custom');
    expect(reconcileOpenCodeRole('build', { status: 'failure' })).toBe('build');
  });

  it('disables failed discovery roles without inline prose and leaves refresh enabled', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    expect(source).toContain("const agentDescriptorsFailed = agentDiscovery.status === 'failure';");
    expect(source).toContain('disabled={unavailable || agentDescriptorsLoading || agentDescriptorsFailed}');
    expect(source).not.toContain('Could not discover agents. Retry.');
    expect(source).toContain('disabled={unavailable}');
  });

  it('keeps compact refresh inline with role select and renders no visible status/help line', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    expect(source).toContain('className="launch-opencode-role-control"');
    expect(source).toContain('title="Refresh agents"');
    expect(source).not.toContain('From project root. Rechecked at launch.');
    expect(source).not.toContain('launch-opencode-role-meta');
  });

  it('hides OpenCode Execution State without changing stored routing semantics', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    expect(source).toContain("descriptor.id !== 'opencode'");
    expect(source).toContain("!profileChosen && selectedHarnessDescriptor?.id !== 'opencode'");
    expect(source).toContain('value={routing.executionState ?? \'\'}');
    expect(source).not.toContain("descriptor.id === 'opencode' && onChange({ executionState: undefined })");
    expect(source).toContain('Effective OpenCode agent');
    expect(source).toContain('<LauncherModelPicker');
    expect(source).toContain('launch-native-field--provider');
  });
});

describe('additive launch status', () => {
  it('retains an unavailable requested family instead of falling back to another harness', () => {
    const available = [{ id: 'claude' as const, label: 'claude' }];
    expect(selectedAvailableFamily(available, 'cursor')).toBeUndefined();
    expect(selectedAvailableFamily(available, 'claude')).toBe(available[0]);
  });

  it('auto-offers an installed optional harness when the enable flag is unset', () => {
    expect(optionalHarnessOffered({ enabled: true, installed: true }, false)).toBe(true);
    expect(optionalHarnessOffered({ enabled: false, installed: true }, false)).toBe(false);
    expect(optionalHarnessOffered({ enabled: true, installed: false }, true)).toBe(false);
    expect(optionalHarnessOffered(undefined, false)).toBe(false);
    expect(optionalHarnessOffered(undefined, true)).toBe(true);
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    expect(source).toContain('optionalHarnessOffered(status, harnessOpenCodeEnabled)');
    expect(source).not.toContain("if (f.id === 'opencode' && !harnessOpenCodeEnabled)");
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

describe('project-scoped conversation history', () => {
  it('uses generic main-owned history for every project launcher', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<AgentConversationHistory projectId={project!.id} unavailableProviders={unavailableHistoryProviders} onResumed={onClose} />');
    expect(source).not.toContain('conversationHistoryEnabled');
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

  it('maps the workspace picker onto a spawn environment choice', () => {
    expect(workspaceForSubmission(true, { kind: 'worktree', baseBranch: 'develop' }, true, 'login_fix')).toEqual({
      kind: 'worktree',
      branchSlug: 'login_fix',
      baseBranch: 'develop'
    });
    expect(workspaceForSubmission(false, { kind: 'worktree' }, true, 'login_fix')).toEqual({ kind: 'unmanaged' });
    expect(workspaceForSubmission(true, { kind: 'unmanaged' }, true, 'login_fix')).toEqual({ kind: 'unmanaged' });
    expect(workspaceForSubmission(true, {
      kind: 'reuse',
      environmentId: '11111111-1111-4111-8111-111111111111'
    }, false, '')).toEqual({
      kind: 'reuse',
      environmentId: '11111111-1111-4111-8111-111111111111'
    });
  });

  it('replaces the isolation checkbox with a workspace picker', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    expect(source).toContain('EnvironmentPicker');
    expect(source).not.toContain('Isolate in a git worktree');
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
