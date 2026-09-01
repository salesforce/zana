import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const appRoot = fileURLToPath(new URL('..', import.meta.url));

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('thread / legacy isolation', () => {
  it('keeps ThreadCommandComposer off the PTY spawn path', () => {
    const source = stripComments(readFileSync(join(appRoot, 'components/ThreadCommandComposer.tsx'), 'utf8'));
    expect(source).toContain('product.threads.create');
    expect(source).not.toContain('createTerminal');
    expect(source).not.toContain('LaunchProfileId');
    expect(source).not.toContain('product.terminals.create');
    expect(source).toContain('ModelReasoningPicker');
    expect(source).toContain('ReasoningEffortPicker');
    expect(source).toContain('ComposerModePicker');
    expect(source).not.toContain('LauncherModelPicker');
  });

  it('keeps the thread model picker off AgentLauncher and PTY launch', () => {
    const picker = stripComments(readFileSync(join(appRoot, 'components/thread/pickers/ModelReasoningPicker.tsx'), 'utf8'));
    const effortPicker = stripComments(readFileSync(join(appRoot, 'components/thread/pickers/ReasoningEffortPicker.tsx'), 'utf8'));
    const modePicker = stripComments(readFileSync(join(appRoot, 'components/thread/pickers/ComposerModePicker.tsx'), 'utf8'));
    const hook = stripComments(readFileSync(join(appRoot, 'components/thread/pickers/useThreadComposerOptions.ts'), 'utf8'));
    const catalog = stripComments(readFileSync(join(appRoot, 'components/thread/pickers/thread-model-catalog.ts'), 'utf8'));
    const icons = stripComments(readFileSync(join(appRoot, 'components/thread/pickers/provider-icon.ts'), 'utf8'));
    expect(picker).not.toContain('LauncherModelPicker');
    expect(picker).not.toContain('createTerminal');
    expect(picker).toContain('providerIconForId');
    expect(effortPicker).not.toContain('LauncherModelPicker');
    expect(effortPicker).not.toContain('createTerminal');
    expect(effortPicker).toContain('thinkingEffortTitle');
    expect(modePicker).not.toContain('LauncherModelPicker');
    expect(modePicker).not.toContain('createTerminal');
    expect(hook).not.toContain('LauncherModelPicker');
    expect(hook).not.toContain('AgentLauncher');
    expect(hook).toContain('prefetchThreadModelCatalog');
    expect(hook).toContain('ensureThreadProviderModels');
    expect(hook).toContain('reconcileReasoningLevel');
    expect(catalog).toContain('executionOptions');
    expect(catalog).toContain('composerActionsFromProvider');
    expect(catalog).not.toContain('list_models');
    expect(catalog).not.toContain('AgentLauncher');
    expect(stripComments(readFileSync(join(appRoot, 'store.ts'), 'utf8'))).toContain('prefetchThreadModelCatalog');
    expect(stripComments(readFileSync(join(appRoot, 'store.ts'), 'utf8'))).toContain('reloadThreadModelCatalog');
    expect(icons).not.toContain('AgentLauncher');
    expect(icons).not.toContain('LauncherModelPicker');
  });

  it('keeps the thread view off terminals.create except the optional workspace shell pane', () => {
    const source = stripComments(readFileSync(join(appRoot, 'views/threads/ThreadDetailView.tsx'), 'utf8'));
    expect(source).toContain('ThreadCommandComposer');
    expect(source).toContain('model={threadModel}');
    expect(source).toContain('reasoningLevel={threadReasoning}');
    expect(source).not.toContain('createTerminal');
    expect(source).not.toContain('LaunchProfileId');
  });

  it('keeps AgentLauncher off the Thread HTTP create path', () => {
    const source = stripComments(readFileSync(join(appRoot, 'components/AgentLauncher.tsx'), 'utf8'));
    expect(source).toContain('ThreadCommandComposer');
    expect(source).toContain('LegacyAgentHomeComposer');
    expect(source).toContain('AutonomousTeamComposer');
    expect(source).toContain('JobTeamComposer');
    expect(source).not.toContain('PromptComposer');
    expect(source).not.toContain('threads.create');
    expect(source).not.toContain('product.threads');
    expect(source).not.toContain('product.teams.launchAutonomous');
    expect(source).not.toContain('product.teams.startJob');
  });

  it('keeps AutonomousTeamComposer on launchAutonomous only', () => {
    const source = stripComments(readFileSync(join(appRoot, 'components/AutonomousTeamComposer.tsx'), 'utf8'));
    expect(source).toContain('product.teams.launchAutonomous');
    expect(source).not.toContain('threads.create');
    expect(source).not.toContain('createTerminal');
    expect(source).not.toContain('ModelReasoningPicker');
    expect(source).not.toContain('ComposerModePicker');
    expect(source).not.toContain('ReasoningEffortPicker');
  });

  it('keeps JobTeamComposer on startJob only', () => {
    const source = stripComments(readFileSync(join(appRoot, 'components/JobTeamComposer.tsx'), 'utf8'));
    expect(source).toContain('product.teams.startJob');
    expect(source).not.toContain('product.teams.launchAutonomous');
    expect(source).not.toContain('threads.create');
    expect(source).not.toContain('createTerminal');
    expect(source).not.toContain('ModelReasoningPicker');
    expect(source).not.toContain('ComposerModePicker');
    expect(source).not.toContain('ReasoningEffortPicker');
  });

  it('keeps Home legacy launch on LegacyAgentHomeComposer, not ThreadCommandComposer', () => {
    const home = stripComments(readFileSync(join(appRoot, 'components/HomeAgentComposer.tsx'), 'utf8'));
    const legacy = stripComments(readFileSync(join(appRoot, 'components/LegacyAgentHomeComposer.tsx'), 'utf8'));
    const thread = stripComments(readFileSync(join(appRoot, 'components/ThreadCommandComposer.tsx'), 'utf8'));
    const field = stripComments(readFileSync(join(appRoot, 'components/composer/use-composer-prompt-field.ts'), 'utf8'));
    expect(home).toContain('allowLegacyAgent');
    expect(home).toContain('LegacyAgentHomeComposer');
    expect(home).toContain('AutonomousTeamComposer');
    expect(home).toContain('JobTeamComposer');
    expect(home).toContain('LaunchModeSegmented');
    expect(home).toContain('showAutonomousTeam={showAutonomousTeam}');
    expect(home).toContain('showJobTeam={showJobTeam}');
    expect(home).toContain("kind === 'autonomous'");
    expect(home).toContain("kind === 'job'");
    expect(home).not.toContain('HomeAutonomousComposer');
    expect(home).not.toContain('createTerminal');
    expect(home).not.toContain('product.teams.launchAutonomous');
    expect(home).not.toContain('product.teams.startJob');
    expect(legacy).toContain('createTerminal');
    expect(legacy).toContain('buildLaunchArgs');
    expect(legacy).toContain("from './legacy-agent-home.js'");
    expect(legacy).toContain('cliAgentModelOptions');
    expect(legacy).toContain('ensureThreadProviderModels');
    expect(legacy).toContain('useComposerPromptField');
    expect(legacy).toContain("kind: 'cli'");
    expect(legacy).not.toContain('ComposerModePicker');
    expect(legacy).not.toContain('LauncherModelPicker');
    expect(legacy).not.toContain('ThreadCommandComposer');
    expect(thread).not.toContain('onSelectLegacyAgent');
    expect(thread).not.toContain('createTerminal');
    expect(thread).not.toContain('LegacyAgentHomeComposer');
    expect(thread).toContain('useComposerPromptField');
    expect(thread).toContain("kind: 'thread'");
    expect(field).not.toContain('createTerminal');
    expect(field).not.toContain('product.threads.create');
    expect(field).not.toContain('ComposerModePicker');
    expect(field).toContain('filterCliComposerCommands');
  });
});
