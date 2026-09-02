import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('LegacyAgentHomeComposer', () => {
  it('spawns through createTerminal without owning the launch-mode switcher', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('createTerminal');
    expect(source).toContain('buildLaunchArgs');
    expect(source).toContain('openAgentModal');
    expect(source).toContain('product.harness.effectiveDefault');
    expect(source).toContain('<ModelReasoningPicker');
    expect(source).toContain('composerProvidersFromCatalog');
    expect(source).toContain('threadProviderIdForFamily');
    expect(source).toContain('familyForThreadProviderId');
    expect(source).toContain('initialText');
    expect(source).toContain('onLaunched');
    expect(source).toContain('onClose');
    expect(source).toContain('data-testid="legacy-agent-command-send"');
    expect(source).toContain('cliAgentModelOptions');
    expect(source).toContain('ensureThreadProviderModels');
    expect(source).toContain('prefetchThreadModelCatalog');
    expect(source).toContain('useComposerPromptField');
    expect(source).toContain("kind: 'cli'");
    expect(source).toContain('assembleCliLaunchPrompt');
    expect(source).toContain('absolutePathMentions');
    expect(source).not.toContain('product.threads.create');
    expect(source).not.toContain('ComposerModePicker');
    expect(source).not.toContain('LauncherModelPicker');
    expect(source).not.toContain('AttachmentPills');
    expect(source).not.toContain('<textarea');
    expect(source).not.toContain('onSelectThread');
    expect(source).not.toContain('legacyAgentSelected');
    expect(source).toContain('<ComposerProjectPicker');
    expect(source).toContain('PluginComposerChrome');
    expect(source).toContain("kind: 'new-thread'");
  });

  it('shows a sending spinner on the launch button while createTerminal is in flight', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Loader2');
    expect(source).toContain('is-sending');
    expect(source).toContain('aria-busy={launching}');
    expect(source).toContain('thread-command-send-spin');
    expect(source).toContain("className={`thread-command-send${launching ? ' is-sending' : ''}`}");
    expect(source).toContain('disabled={launching}');
  });

  it('uploads remote-project path mentions before launch and rewrites the prompt', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain("product.fs.uploadToRemote(project.id, localPath, '.')");
    expect(source).toContain('absolutePathMentions(serialized.mentions)');
    expect(source).toContain('rewritePromptPaths(promptText, uploaded)');
  });

  it('discovers OpenCode roles through project-id IPC once, refreshing only on explicit request', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('product.harness.agentDescriptors(\n      openCodeDiscoveryProjectId,\n      openCodeDiscoveryProfile,\n      agentDescriptorsRefresh > 0\n    )');
    expect(source).toContain('setAgentDescriptorsRefresh((value) => value + 1)');
    expect(source).toContain('discoveryForOpenCodePicker');
    expect(source).toContain('resolveOpenCodeRoleOptions');
    expect(source).toContain('setRoleTargetId((current) => reconcileOpenCodeRole(current, discovery));');
    expect(source).toMatch(/return \(\) => \{\s*cancelled = true;\s*\};/);
  });

  it('offers the OpenCode native role via a popover picker only for the opencode family', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<NativeRolePicker');
    expect(source).toContain("familyId === 'opencode' ? (");
    expect(source).toContain('value={roleTargetId}');
    expect(source).toContain('onChange={setRoleTargetId}');
  });

  it('defaults the harness project-independently like Modern, keeping effectiveDefault as fallback', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    // Modern-parity provider default: last-used provider (else claude-code)
    // mapped to a family, resolved once descriptors have loaded.
    expect(source).toContain("familyForThreadProviderId(rememberedProviderId() ?? 'claude-code') ?? 'claude'");
    expect(source).toContain('descriptorsLoaded');
    expect(source).toContain('const preferredHarness = harnesses.find((descriptor) => descriptor.id === preferredFamily);');
    // effectiveDefault survives only as the fallback when the preferred family is unavailable.
    expect(source).toContain('product.harness.effectiveDefault(projectId)');
    // Concrete model resolution instead of resting on "Select model".
    expect(source).toContain('preferredComposerModel({');
    expect(source).toContain('fallbackModelsForProvider(selectedProviderId)');
    expect(source).not.toContain('if (selectionState !== \'resolved\' || (modelId && models.some((model) => model.id === modelId))) return;');
  });

  it('keeps an explicit harness pick sticky against late async re-renders', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    // The auto-default effect must bail when the user has explicitly switched
    // harness, so a late personas/catalog/config load can't clobber the pick.
    expect(source).toContain("if (selectionProvenance === 'explicit') return;");
    // Project change re-enables auto-defaulting for the new project.
    const onChange = source.slice(source.indexOf('onChange={(nextProjectId) => {'));
    expect(onChange).toContain("setSelectionProvenance('automatic');");
    expect(onChange.indexOf("setSelectionProvenance('automatic');"))
      .toBeLessThan(onChange.indexOf('setProjectId(nextProjectId);'));
  });

  it('replaces the isolation checkbox with a workspace picker for real local projects', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<EnvironmentPicker');
    expect(source).toContain('project && !project.remote &&');
    expect(source).toContain('defaultWorkspaceChoice');
    expect(source).not.toContain('Isolate in a git worktree');
  });
});
