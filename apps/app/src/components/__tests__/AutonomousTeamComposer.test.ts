import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('AutonomousTeamComposer', () => {
  it('launches through launchAutonomous without thread or PTY APIs', () => {
    const source = readFileSync(new URL('../AutonomousTeamComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('product.teams.launchAutonomous');
    expect(source).toContain('useComposerPromptField');
    expect(source).toContain("kind: 'cli'");
    expect(source).toContain('assembleCliLaunchPrompt');
    expect(source).toContain('absolutePathMentions');
    expect(source).toContain('PopoverPicklist');
    expect(source).toContain('ariaLabel="Team"');
    expect(source).toContain('Describe a goal for the team');
    expect(source).toContain('disabled={!canLaunch}');
    expect(source).toContain('goalReady');
    expect(source).toContain('data-testid="autonomous-team-command-send"');
    expect(source).toContain('<ComposerProjectPicker');
    expect(source).toContain('PluginComposerChrome');
    expect(source).toContain("kind: 'new-thread'");
    expect(source).toContain('initialText');
    expect(source).toContain('onClose');
    expect(source).not.toContain('product.threads.create');
    expect(source).not.toContain('createTerminal');
    expect(source).not.toContain('ModelReasoningPicker');
    expect(source).not.toContain('ComposerModePicker');
    expect(source).not.toContain('ReasoningEffortPicker');
    expect(source).not.toContain('EnvironmentPicker');
    expect(source).not.toContain('LauncherModelPicker');
    expect(source).not.toContain('<textarea');
  });
});
