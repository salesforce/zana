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
    expect(source).toContain('availableModelsToPickerOptions');
    expect(source).toContain('modelOptions={availableModelsToPickerOptions(models)}');
    expect(source).toContain('moreModelOptions={availableModelsToPickerOptions(moreModelOptions)}');
    expect(source).toContain('const preferHostModels = true');
    expect(source).toContain('const catalogHostId = project?.hostId ?? executionHostId');
    expect(source).toContain('ensureThreadProviderModels');
    expect(source).toContain('setThreadModelCatalogHost');
    expect(source).not.toContain('prefetchThreadModelCatalog');
    expect(source).toContain('cliRemoteHostCatalogEnabled');
    expect(source).toContain('cliAgentCatalogProviders');
    expect(source).toContain('cliAgentFamilyIdsFromCatalog');
    expect(source).toContain('preferHostModels');
    expect(source).toContain('defaultHostId');
    expect(source).toContain('useHosts');
    expect(source).toContain('pickOfferedComposerModel');
    expect(source).toContain('rememberComposerSelection');
    expect(source).toContain('resolveCliAgentFamily');
    expect(source).toContain('resolveCliAgentSpawnProfile');
    expect(source).toContain('rememberedSelectionFor');
    expect(source).toContain('useComposerPromptField');
    expect(source).toContain("kind: 'cli'");
    expect(source).toContain('assembleCliLaunchPrompt');
    expect(source).toContain('stageRemoteComposerAttachments');
    expect(source).toContain('composerDropProjectRoot');
    expect(source).not.toContain('product.threads.create');
    expect(source).toContain('ComposerModePicker');
    expect(source).toContain('cliComposerModeChip');
    expect(source).toContain('cliLaunchExecutionState');
    expect(source).not.toContain('LauncherModelPicker');
    expect(source).not.toContain('AttachmentPills');
    expect(source).not.toContain('<textarea');
    expect(source).not.toContain('onSelectThread');
    expect(source).not.toContain('legacyAgentSelected');
    expect(source).toContain('<ComposerProjectPicker');
    expect(source).toContain('preferredComposerProjectId');
    expect(source).toContain('PluginComposerChrome');
    expect(source).toContain("kind: 'cli-agent'");
    expect(source).toContain('PluginComposerMeta');
    expect(source).toContain('PluginComposerAdvanced');
    expect(source).toContain('legacy-agent-customize-launch');
    expect(source).toContain('launch-advanced-card');
    expect(source).toContain('Extra args');
    expect(source).toContain('applyLaunchPatch');
    expect(source).toContain('personaId: personaId || undefined');
    expect(source).toContain('permissionModeOptionsFor');
    expect(source).toContain('cliLaunchFromPermissionMode');
    expect(source).toContain('unrestrictedProfileId');
    expect(source).toContain('fallbackProviderOption');
    expect(source).toContain('ariaLabel="Permission mode"');
    expect(source).toContain('permissionOptions.length > 1');
    expect(source).toContain('compactLabel: row.compactLabel');
    expect(source).toContain('description: row.description');
    expect(source).not.toContain("kind: 'new-thread'");
    expect(source).not.toContain('claude-yolo');
    expect(source).not.toContain('Execution state');
    expect(source).not.toContain('yoloActive');
    expect(source).not.toContain('setExecutionState');
    expect(source).not.toContain('cli-yolo-chip');
  });

  it('shows a sending spinner on the launch button while createTerminal is in flight', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Loader2');
    expect(source).toContain('is-sending');
    expect(source).toContain('aria-busy={launching}');
    expect(source).toContain('thread-command-send-spin');
    expect(source).toContain("className={`thread-command-send${launching ? ' is-sending' : ''}`}");
    expect(source).toContain('disabled={!canLaunch}');
  });

  it('uploads remote-project attaches before launch and rewrites the prompt', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('stageRemoteComposerAttachments');
    expect(source).toContain("product.fs.uploadToRemote(project.id, localPath, '.')");
    expect(source).toContain('product.fs.uploadProjectAttachmentToRemote(project.id, relativePath)');
    expect(source).toContain('composerDropProjectRoot(project)');
  });

  it('sources OpenCode roles from the SAME ACP mode list as the Modern composer', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    // Full parity: the CLI picker reads the shared ACP session-mode list off the
    // model catalog rather than running its own `opencode agent list` discovery.
    expect(source).toContain("familyId === 'opencode'\n    ? visibleAcpModeOptions(catalogEntry?.acpMode?.options ?? [], nativeAgentDiscoveryEnabled)");
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
    // Edits → executionState must not ride with a native role (OpenCode preflight).
    expect(source).toContain('cliLaunchExecutionState');
    expect(source).toContain('hasNativeRole: Boolean(validRoleId)');
    expect(source).toContain('unrestrictedProfileSelected: Boolean(permLaunch.profileId)');
  });

  it('offers the OpenCode native role via a popover picker only for the opencode family', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<NativeRolePicker');
    expect(source).toContain("familyId === 'opencode' ? (");
    expect(source).toContain('value={roleTargetId}');
    expect(source).toContain('onChange={setRoleTargetId}');
    expect(source).toContain('consumeComposerModeCycle');
    expect(source).toContain('interceptKeyDown');
    expect(source).toContain("kind: 'native'");
    expect(source).toContain('options: roleOptions');
    expect(source).toContain('onChange: setRoleTargetId');
  });

  it('offers ComposerModePicker Agent/Plan only for Claude, Cursor, and Codex', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<ComposerModePicker');
    expect(source).toContain("modeChip === 'work-mode'");
    expect(source).toContain('entries={CLI_WORK_MODE_ENTRIES}');
    expect(source).toContain('cliComposerModeChip');
    expect(source).toContain("kind: 'work'");
    expect(source).not.toContain("kind: 'new-thread'");
    expect(source).toContain("familyId === 'opencode' ? (");
    expect(source).toContain('<NativeRolePicker');
  });

  it('puts mode before the harness picker, matching Thread', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    const footer = source.slice(source.indexOf('thread-command-footer-start'));
    expect(footer.indexOf('<ComposerModePicker')).toBeLessThan(footer.indexOf('<ModelReasoningPicker'));
    expect(footer.indexOf('<NativeRolePicker')).toBeLessThan(footer.indexOf('<ModelReasoningPicker'));
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
    expect(source).toContain("setSelectionProvenance('explicit');\n      if (availableFamilyIds.length > 0)");
  });

  it('replaces the isolation checkbox with a workspace picker for real local projects', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<EnvironmentPicker');
    expect(source).toContain('project?.remote');
    expect(source).toContain('defaultWorkspaceChoice');
    expect(source).not.toContain('Isolate in a git worktree');
    const metaStart = source.indexOf('thread-command-composer-meta-start');
    const metaEnd = source.indexOf('thread-command-composer-meta-end');
    const envIdx = source.indexOf('<EnvironmentPicker');
    const customizeIdx = source.indexOf('legacy-agent-customize-launch');
    expect(envIdx).toBeGreaterThan(metaStart);
    expect(customizeIdx).toBeGreaterThan(envIdx);
    expect(customizeIdx).toBeLessThan(metaEnd);
  });

  it('marks an SSH project as Remote host', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('agentCardRuntimeLabel');
    expect(source).toContain('data-testid="composer-remote-host-mark"');
    expect(source).toContain('remote: true');
    expect(source).not.toContain('composer-remote-runtime-picker');
    expect(source).not.toContain('thread-command-runtime-picker');
    expect(source).not.toContain('cliRemoteToolsExperiment');
    expect(source).not.toContain('remoteToolProxy');
    expect(source).not.toContain('composerRemoteToolsMark');
    expect(source).not.toContain('remote: project.remote');
  });

  it('scopes the model catalog to the project host like Modern, including remote machines', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('void setThreadModelCatalogHost(catalogHostId)');
    expect(source).toContain('[catalogHostId, hosts.length]');
    expect(source).toContain('if (!catalogHostId && hosts.length === 0) return');
    expect(source).toContain('const catalogHostId = project?.hostId ?? executionHostId');
    expect(source).not.toContain('setThreadModelCatalogHost(undefined)');
    expect(source).not.toContain('prefetchThreadModelCatalog');
    expect(source).toContain('cliRemoteHostCatalogEnabled\n      ? cliAgentCatalogProviders(catalog.providers)');
    expect(source).not.toContain('cliRemoteHostCatalogEnabled && isRemoteWorkspaceProject(project)');
    expect(source).not.toContain('!isRemoteWorkspaceProject(project) || cliRemoteHostCatalogEnabled');
  });

  it('feeds Thread selectedOnlyModels into the shared ModelReasoningPicker More list', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('catalogMoreModels: catalogEntry?.selectedOnlyModels');
    expect(source).toContain('fallbackMoreModelsForProvider');
    expect(source).toContain('fallbackModelsForProvider');
    expect(source).toContain('moreModelOptions={availableModelsToPickerOptions(moreModelOptions)}');
    expect(source).toContain('<ModelReasoningPicker');
    expect(source).not.toContain('cliAgentPickerOptions');
  });

  it('does not skeleton the model picker while harness default is still resolving', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('modelIsLoading={catalogModelsLoading}');
    expect(source).not.toContain("selectionState === 'loading' || catalogModelsLoading");
    expect(source).toContain('&& !catalogEntry');
    expect(source).toContain('catalog.inflight.has(selectedProviderId)');
    expect(source).toContain('if (!selectedProviderId || catalogEntry) return');
    expect(source).toContain("familyForThreadProviderId(rememberedProviderId() ?? 'claude-code') ?? 'claude'");
    expect(source).toContain('if (catalogModelsLoading) return');
    expect(source).not.toContain("selectionState !== 'resolved' || catalogModelsLoading");
  });

  it('keeps launch available while the host catalog and local descriptor settle independently', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('resolveCliAgentSpawnProfile({');
    expect(source).toContain('&& spawnProfile');
    expect(source).toContain("const message = 'Agent launch failed: no launch profile for this harness'");
    expect(source).toContain("pushToast(message, 'error')");
    expect(source).not.toContain('if (!profile) return;');
    expect(source).not.toContain("selectionProvenance === 'automatic'\n      ? automaticProfile");
    expect(source).not.toContain("selectionProvenance !== 'explicit'\n      || selectedHarness");
  });

  it('launches absolute-path prompts when slash-command typeahead has no matches', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('if (field.typeaheadOpen && field.suggestions.length > 0) return;');
    expect(source).not.toContain('if (field.typeaheadOpen) return;');
  });
});
