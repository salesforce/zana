import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('TeamComposer', () => {
  it('launches both planning modes through durable startJob without thread or PTY APIs', () => {
    const source = readFileSync(new URL('../TeamComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('product.teams.startJob');
    expect(source).toContain('useComposerPromptField');
    expect(source).toContain("kind: 'cli'");
    expect(source).toContain('assembleCliLaunchPrompt');
    expect(source).toContain('stageRemoteComposerAttachments');
    expect(source).toContain('composerDropProjectRoot');
    expect(source).toContain('preferredComposerProjectId');
    expect(source).toContain('PopoverPicklist');
    expect(source).toContain('ariaLabel="Team"');
    expect(source).toContain('Describe a goal for the team');
    expect(source).toContain('disabled={!canLaunch}');
    expect(source).toContain('goalReady');
    expect(source).toContain('field.text.trim().length > 0');
    expect(source).toContain('data-testid="team-command-send"');
    expect(source).toContain("useState<Extract<TeamCoordinationMode, 'structured' | 'freeform'>>('freeform')");
    expect(source).toContain("{ value: 'freeform', label: 'Infer plan from goal' }");
    expect(source).toContain("{ value: 'structured', label: 'Plan provided in goal' }");
    expect(source).toContain('coordinationMode,');
    expect(source).not.toContain("origin: 'explicit'");
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
    expect(source).toContain("className=\"composer-control-tooltip\" data-tooltip={field.canAttach ? 'Attach files' : 'File attachments require the desktop app'}");
    expect(source).toContain('className="composer-control-tooltip" data-tooltip="Attach source files for the team to work from"');
    expect(source).toContain("'Start voice input'");
  });

  it('carries the job-specific optional Title/Summary and attached source capabilities', () => {
    const source = readFileSync(new URL('../TeamComposer.tsx', import.meta.url), 'utf8');
    // Optional job metadata fields, defaulting the title from the goal.
    expect(source).toContain('id="team-title"');
    expect(source).toContain('id="team-summary"');
    expect(source).toContain("...(title.trim() ? { title: title.trim() } : {})");
    expect(source).not.toContain('titleFromPrompt');
    expect(source).toContain('summary: summary.trim()');
    // Source capabilities are minted through the native chooser (opaque ids),
    // deduplicated, and passed as sourceCapabilityIds — never paths.
    expect(source).toContain('product.executionSources.pick');
    expect(source).toContain('sourceCapabilityIds: jobSources.map');
    expect(source).toContain('ExecutionSourceCapabilityView');
  });
});
