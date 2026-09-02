import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { executionMappingOptions } from '@zana-ai/zcc-domain/harness-adapter';
import { appendAttachmentContext, mergeAttachmentPaths } from '../../lib/attachments.js';
import {
  buildLaunchArgs,
  discoveryForOpenCodePicker,
  resolveOpenCodeRoleOptions,
  reconcileOpenCodeRole
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
});

describe('launch mode', () => {
  it('offers Modern, CLI Agent, and Autonomous Team without gating the whole control on teams', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    expect(source).toContain("useState<LaunchMode>('thread')");
    expect(source).toContain('<LaunchModeSegmented');
    expect(source).toContain('showAutonomousTeam={teams.length > 0}');
    expect(source).not.toContain('Single agent');
    expect(source).toContain('<ThreadCommandComposer');
    expect(source).toContain('<LegacyAgentHomeComposer');
    expect(source).toContain('<AutonomousTeamComposer');
    expect(source).toContain('initialText={initialPrompt}');
    expect(source).toContain('onCreated={onClose}');
    expect(source).toContain("{mode === 'autonomous' && (");
    expect(source).not.toContain('<PromptComposer');
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
});

describe('project-scoped conversation history', () => {
  it('uses generic main-owned history for every project launcher', () => {
    const source = readFileSync(new URL('../AgentLauncher.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<AgentConversationHistory projectId={project!.id} unavailableProviders={unavailableHistoryProviders} onResumed={onClose} />');
    expect(source).not.toContain('conversationHistoryEnabled');
  });
});

