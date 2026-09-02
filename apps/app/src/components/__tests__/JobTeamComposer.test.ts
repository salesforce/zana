import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('JobTeamComposer', () => {
  it('launches a durable job through startJob without thread or PTY APIs', () => {
    const source = readFileSync(new URL('../JobTeamComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('product.teams.startJob');
    expect(source).toContain('useComposerPromptField');
    expect(source).toContain("kind: 'cli'");
    expect(source).toContain('assembleCliLaunchPrompt');
    expect(source).toContain('absolutePathMentions');
    expect(source).toContain('PopoverPicklist');
    expect(source).toContain('ariaLabel="Team"');
    expect(source).toContain('Describe a goal for the team');
    expect(source).toContain('disabled={!canLaunch}');
    expect(source).toContain('goalReady');
    expect(source).toContain('data-testid="job-team-command-send"');
    expect(source).toContain('<ComposerProjectPicker');
    expect(source).toContain('PluginComposerChrome');
    expect(source).toContain("kind: 'new-thread'");
    expect(source).toContain('initialText');
    expect(source).toContain('onClose');
    expect(source).not.toContain('product.threads.create');
    expect(source).not.toContain('product.teams.launchAutonomous');
    expect(source).not.toContain('createTerminal');
    expect(source).not.toContain('ModelReasoningPicker');
    expect(source).not.toContain('ComposerModePicker');
    expect(source).not.toContain('ReasoningEffortPicker');
    expect(source).not.toContain('EnvironmentPicker');
    expect(source).not.toContain('LauncherModelPicker');
  });

  it('carries the job-specific optional Title/Summary and attached source capabilities', () => {
    const source = readFileSync(new URL('../JobTeamComposer.tsx', import.meta.url), 'utf8');
    // Optional job metadata fields, defaulting the title from the goal.
    expect(source).toContain('id="job-team-title"');
    expect(source).toContain('id="job-team-summary"');
    expect(source).toContain('titleFromPrompt(goal)');
    expect(source).toContain('summary: summary.trim()');
    // Source capabilities are minted through the native chooser (opaque ids),
    // deduplicated, and passed as sourceCapabilityIds — never paths.
    expect(source).toContain('product.executionSources.pick');
    expect(source).toContain('sourceCapabilityIds: jobSources.map');
    expect(source).toContain('ExecutionSourceCapabilityView');
  });
});
