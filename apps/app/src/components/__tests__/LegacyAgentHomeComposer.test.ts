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
    expect(source).toContain('pickOfferedComposerModel');
    expect(source).toContain('rememberComposerSelection');
    expect(source).toContain('resolveCliAgentFamily');
    expect(source).toContain('rememberedSelectionFor');
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

  it('sources OpenCode roles from the SAME ACP mode list as the Modern composer', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    // Full parity: the CLI picker reads the shared ACP session-mode list off the
    // model catalog rather than running its own `opencode agent list` discovery.
    expect(source).toContain("familyId === 'opencode'\n    ? catalogEntry?.acpMode?.options ?? []");
    // The divergent PTY-discovery path is gone.
    expect(source).not.toContain('product.harness.agentDescriptors');
    expect(source).not.toContain('discoveryForOpenCodePicker');
    expect(source).not.toContain('resolveOpenCodeRoleOptions');
    expect(source).not.toContain('reconcileOpenCodeRole');
    // Refresh re-fetches the provider's catalog entry (same as Modern's refresh).
    expect(source).toContain('reloadThreadProviderModels(selectedProviderId)');
    // Role selection stays coherent with the loaded mode list.
    expect(source).toContain('setRoleTargetId(catalogEntry.acpMode.currentValue)');
  });

  it('drops the forced catalog model when a native OpenCode role is picked', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    // A native agent pins its own model; forcing an `aisuite/*` catalog `--model`
    // alongside `--agent <role>` breaks with ProviderModelNotFoundError on any
    // install whose provider inventory differs from the shipped snapshot. Role and
    // forced model are therefore mutually exclusive — the role wins, no model.
    expect(source).toContain('const adapterEntry = validRoleId\n        ? { roleTargetId: validRoleId }');
    expect(source).toContain('        : validModelId\n          ? { modelTargetId: validModelId }\n          : {};');
    // The old shape spread BOTH selectors into the adapter entry.
    expect(source).not.toContain('...(validRoleId ? { roleTargetId: validRoleId } : {})');
  });

  it('offers the OpenCode native role via a popover picker only for the opencode family', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<NativeRolePicker');
    expect(source).toContain("familyId === 'opencode' ? (");
    expect(source).toContain('value={roleTargetId}');
    expect(source).toContain('onChange={setRoleTargetId}');
  });

  it('defaults the harness like Modern via resolveCliAgentFamily (current → remembered → effectiveDefault)', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    // Family precedence is delegated to the shared helper: keep the current pick,
    // else the last-used (remembered) family, else the project's effective default.
    expect(source).toContain('resolveCliAgentFamily({');
    expect(source).toContain("familyForThreadProviderId(rememberedProviderId() ?? '')");
    // effectiveDefault survives only as the async fallback.
    expect(source).toContain('product.harness.effectiveDefault(projectId)');
    // Concrete model resolution instead of resting on "Select model".
    expect(source).toContain('pickOfferedComposerModel({');
    expect(source).toContain('offeredModels: offeredModelIds');
    expect(source).not.toContain('if (selectionState !== \'resolved\' || (modelId && models.some((model) => model.id === modelId))) return;');
  });

  it('keeps the current harness pick sticky by feeding familyIdRef into resolveCliAgentFamily', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    // No explicit-provenance guard: the helper keeps the current family when it is
    // still available, so a late personas/catalog/config load can't clobber the pick.
    expect(source).toContain('const currentFamilyId = familyIdRef.current;');
    expect(source).toContain('currentFamilyId,');
    // A remembered family restores its remembered model on switch.
    expect(source).toContain('rememberedSelectionFor(providerId)?.model');
  });

  it('replaces the isolation checkbox with a workspace picker for real local projects', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<EnvironmentPicker');
    expect(source).toContain('project && !project.remote &&');
    expect(source).toContain('defaultWorkspaceChoice');
    expect(source).not.toContain('Isolate in a git worktree');
  });
});
