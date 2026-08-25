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
    expect(source).not.toContain('threads.create');
    expect(source).not.toContain('product.threads');
  });
});
