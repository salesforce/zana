import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHomeLauncherPreferences } from '../HomeAgentComposer.js';

describe('HomeAgentComposer preferences', () => {
  it('ignores legacy harness selection so configured defaults win on opening', () => {
    expect(parseHomeLauncherPreferences(JSON.stringify({
      projectId: 'p1',
      familyId: 'opencode',
      modelId: 'gpt-5'
    }))).toEqual({ projectId: 'p1', modelId: 'gpt-5' });
  });

  it('drops malformed stored values', () => {
    expect(parseHomeLauncherPreferences('{')).toEqual({});
    expect(parseHomeLauncherPreferences(JSON.stringify({ projectId: 3, modelId: false }))).toEqual({});
  });
});

describe('HomeAgentComposer layout', () => {
  it('wraps the thread composer so New Chat keeps its create-surface spacing', () => {
    const source = readFileSync(new URL('../HomeAgentComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('home-agent-composer');
    expect(source).toContain('is-walkthrough-spotlight');
    expect(source).toContain('walkthroughHomeMode');
    expect(source).toContain('<ThreadCommandComposer');
    expect(source).toContain('allowLegacyAgent');
    expect(source).toContain('<LaunchModeSegmented');
    expect(source).toContain('<LegacyAgentHomeComposer');
    expect(source).toContain('<AutonomousTeamComposer');
    expect(source).toContain('<JobTeamComposer');
    expect(source).toContain("kind === 'agent'");
    expect(source).toContain("kind === 'autonomous'");
    expect(source).toContain("kind === 'job'");
    expect(source).toContain('showAutonomousTeam={showAutonomousTeam}');
    expect(source).toContain('showJobTeam={showJobTeam}');
    expect(source).not.toContain('HomeAutonomousComposer');
    expect(source).not.toContain('onSelectLegacyAgent');
  });

  it('spotlights the composer while the walkthrough is on Modern or CLI Agent', () => {
    const source = readFileSync(new URL('../HomeAgentComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain("walkthroughHomeMode === 'thread' || walkthroughHomeMode === 'agent'");
    expect(source).toContain('setKind(walkthroughHomeMode)');
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    expect(css).toContain('.home-agent-composer.is-walkthrough-spotlight');
    expect(css).toContain('.walkthrough-backdrop--composer');
    expect(css).toContain('.launch-segmented-new');
    const tourStart = css.indexOf('.walkthrough-backdrop {');
    expect(tourStart).toBeGreaterThan(-1);
    expect(css.slice(tourStart, css.indexOf('}', tourStart))).toContain('align-items: flex-start;');
  });
});

describe('ThreadCommandComposer chrome', () => {
  it('keeps the follow-up box compact and aligned to the conversation column', () => {
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    const editor = css.slice(
      css.indexOf('.thread-command-editor.ProseMirror,\n.thread-command-editor {'),
      css.indexOf('.thread-command-editor.ProseMirror p.is-editor-empty:first-child::before')
    );
    expect(editor).toContain('min-height: 40px;');
    expect(editor).toContain('max-height: 12rem;');
    expect(editor).toContain('textarea.thread-command-editor');
    expect(editor).not.toContain('min-height: 80px;');
    expect(editor).not.toContain('max-height: 70dvh;');

    const threadComposer = css.slice(
      css.indexOf('.thread-detail-column {'),
      css.indexOf('.thread-detail-header {')
    );
    expect(threadComposer).toContain('max-width: 54rem;');
    expect(threadComposer).toContain('justify-self: center;');
    expect(threadComposer).toContain('flex: 0 0 auto;');
    const timeline = css.slice(
      css.indexOf('.thread-detail-timeline-shell {'),
      css.indexOf('.thread-timeline-turn {')
    );
    expect(timeline).not.toContain('max-width:');
    expect(timeline).not.toContain('margin-inline:');

    const wide = css.slice(
      css.indexOf('@media (min-width: 1280px) {'),
      css.indexOf('.thread-detail-header {')
    );
    expect(wide).toContain('max-width: 60rem;');
    expect(wide).toContain('min-height: 52px;');
    expect(wide).toContain('max-height: 16rem;');
  });
});

describe('ThreadCommandComposer initial text', () => {
  it('seeds the TipTap editor once from initialText', () => {
    const source = readFileSync(new URL('../ThreadCommandComposer.tsx', import.meta.url), 'utf8');
    const field = readFileSync(new URL('../composer/use-composer-prompt-field.ts', import.meta.url), 'utf8');
    expect(source).toContain('initialText?: string');
    expect(source).toContain('initialText,');
    expect(source).toContain('useComposerPromptField');
    expect(field).toContain('seededInitialText');
    expect(field).toContain('editor.chain().insertContent(initialText)');
    expect(field).toContain('if (autoFocus) chain.focus()');
  });

  it('stays on the project thread URL after create from a workspace', () => {
    const source = readFileSync(new URL('../ThreadCommandComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('route.isProjectWorkspace ? route.focusedProjectId');
    expect(source).toContain('getThreadRoutePath');
  });
});

describe('ThreadCommandComposer pinning', () => {
  it('locks to a passed project and skips the scratch default', () => {
    const source = readFileSync(new URL('../ThreadCommandComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('project: pinnedProject');
    expect(source).toContain('if (pinnedProject) {');
    expect(source).toContain('setProjectId(pinnedProject.id)');
    expect(source).toContain('disabled={Boolean(pinnedProject)}');
    expect(source).toContain('ensureQuickAgent');
    expect(source).toContain('resolveComposerProjectId');
    expect(source).toContain('<ComposerProjectPicker');
    expect(source).not.toContain('{!pinnedProject && (');
    expect(source).not.toContain('projects[0]!');
  });
});

describe('ThreadCommandComposer pairing copy', () => {
  it('copies pairing commands through the desktop clipboard bridge', () => {
    const source = readFileSync(new URL('../ThreadCommandComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('void copyText(pairingCommand)');
    expect(source).not.toContain('navigator.clipboard');
  });
});

describe('ThreadCommandComposer submit path', () => {
  it('creates and follows up through the Thread HTTP API', () => {
    const source = readFileSync(new URL('../ThreadCommandComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('product.threads.create');
    expect(source).toContain('hostId,');
    expect(source).toContain('isForeignExecutionHost');
    expect(source).toContain("kind: 'personal'");
    expect(source).toContain('cwd: foreignHost ? undefined : selected!.path');
    expect(source).toContain('field.serialize()');
    expect(source).toContain('mentions: serialized.mentions');
    expect(source).toContain('Enter a message first');
    expect(source).toContain('Could not send message');
    expect(source).toContain('options.rosterReady');
    expect(source).toContain('options.registeredProviderIds.includes(resolvedProviderId)');
    expect(source).toContain('That harness is not available for Modern threads');
    expect(source).toContain('permissionMode: permissionMode as');
    expect(source).toContain('permissionModeOptionsFor');
    expect(source).toContain('compactLabel: row.compactLabel');
    expect(source).toContain('description: row.description');
    expect(source).toContain('permissionOptions.length > 1');
    expect(source).not.toContain('permissionChipLabel');
    expect(source).not.toContain('permissionModes[0]');
    expect(source).toContain('product.threads.send');
    expect(source).toContain('EnvironmentPicker');
    expect(source).not.toContain('createTerminal(');
    expect(source).not.toContain('openAgentModal');
  });

  it('shows follow-up model inside the card and Local/Edits under it', () => {
    const source = readFileSync(new URL('../ThreadCommandComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('environmentLabel');
    expect(source).toContain('thread-env-label');
    expect(source).toContain('thread-command-composer-meta');
    expect(source).toContain("<Laptop size={14}");
    expect(source).toContain("{threadId ? (");
    expect(source).toContain('className="thread-command-chip thread-command-env"');
    expect(source).not.toContain('onOpenExplorer');
    expect(source).toContain('threadId && shouldShowThreadStop(threadId, status, inFlightRetry)');
    expect(source).toContain('data-testid="thread-command-stop"');
    expect(source).toContain('className="thread-command-stop"');
    expect(source).toContain('fill="currentColor"');
    expect(source).toContain('ariaLabel="Permission mode"');
    expect(source).toContain('searchable={false}');
    expect(source).toContain("tone: row.tone");
    expect(source).toContain('VoiceRecordingBar');
    expect(source).toContain('Start voice input');
    expect(source).toContain('expandTestId="thread-command-expand"');
    expect(source).toContain('<ThreadContextMeter');
    expect(source).toContain('contextWindowUsage');
    expect(source).toContain('onTranscript');
    expect(source).not.toContain('Queue if active');
    expect(source).not.toContain('VoiceInputButton');
    const metaIdx = source.indexOf('thread-command-composer-meta');
    expect(source.indexOf('<ComposerModePicker')).toBeLessThan(source.indexOf('<ModelReasoningPicker'));
    expect(source.indexOf('<ModelReasoningPicker')).toBeLessThan(source.indexOf('<ReasoningEffortPicker'));
    expect(source.indexOf('<ReasoningEffortPicker')).toBeLessThan(metaIdx);
    expect(source).toContain('onSelectedProviderChange={threadId ? undefined : options.setProviderId}');
    expect(source).not.toContain('showLegacyAgent');
    expect(source).not.toContain('onSelectLegacyAgent');
    expect(source).toContain('reasoningLevel: options.reasoningLevel');
    expect(source).toContain('moreModelOptions={options.moreModelOptions}');
    expect(source).toContain('applyComposerModePrefix');
    expect(source).toContain('nextComposerWorkMode');
    expect(source).toContain("event.key !== 'Tab'");
    expect(source).toContain('includeDisconnected');
    expect(source).toContain('ComposerHostActionChip');
    expect(source).toContain('composerRemoteToolsMark');
    expect(source).toContain('composerHostsForProject');
    expect(source).toContain('composer-remote-tools-mark');
    expect(source).toContain('HostSshIdentityDialog');
    expect(source.indexOf('<EnvironmentPicker')).toBeGreaterThan(metaIdx);
    expect(source.indexOf('ariaLabel="Permission mode"')).toBeGreaterThan(metaIdx);

    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    const stopStart = css.indexOf('.thread-command-composer .thread-command-stop {');
    expect(stopStart).toBeGreaterThan(-1);
    expect(css.slice(stopStart, css.indexOf('}', stopStart))).toContain('color: var(--danger);');
    expect(css).toContain('.launch-model-picker-option-description');
    expect(css).toContain('.launch-model-picker-option.is-warning');
    expect(css).toContain('.launch-model-picker-trigger.is-warning');
    const envStart = css.indexOf('.thread-command-env {');
    expect(envStart).toBeGreaterThan(-1);
    expect(css.slice(envStart, css.indexOf('}', envStart))).toContain('cursor: default;');
  });

  it('shows a sending spinner and freezes the editor while submit is in flight', () => {
    const source = readFileSync(new URL('../ThreadCommandComposer.tsx', import.meta.url), 'utf8');
    const field = readFileSync(new URL('../composer/use-composer-prompt-field.ts', import.meta.url), 'utf8');
    expect(source).toContain('Loader2');
    expect(source).toContain('is-sending');
    expect(source).toContain("'Sending'");
    expect(source).toContain('aria-busy={busy}');
    expect(source).toContain('thread-command-send-spin');
    expect(source).toContain('disabled: busy');
    expect(source).toContain('field.markRestoreFocus()');
    expect(source).toContain('onMouseDown={(event) => event.preventDefault()}');
    expect(field).toContain('setEditable');
    expect(field).toContain('editor.setEditable(!disabled)');
    expect(field).toContain('restoreFocusAfterSubmitRef');
    expect(field).toContain("editor.commands.focus('end'");

    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    const sendingStart = css.indexOf('.thread-command-composer .thread-command-send.is-sending,');
    expect(sendingStart).toBeGreaterThan(-1);
    const sending = css.slice(sendingStart, css.indexOf('}', sendingStart));
    expect(sending).toContain('opacity: 1;');
    expect(sending).toContain('cursor: progress;');
    expect(css).toContain('.thread-command-send-spin');
    expect(css).toContain('animation: cu-spin 0.8s linear infinite;');
    expect(css).toContain('.thread-command-composer.is-sending .thread-command-editor');
  });

  it('steals typeahead keys while the menu is open and inserts mention pills', () => {
    const source = readFileSync(new URL('../ThreadCommandComposer.tsx', import.meta.url), 'utf8');
    const field = readFileSync(new URL('../composer/use-composer-prompt-field.ts', import.meta.url), 'utf8');
    const ui = readFileSync(new URL('../composer/ComposerPromptField.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<ComposerPromptField');
    expect(field).toContain('typeaheadKeyAction');
    expect(field).toContain('composerPromptExtensions');
    expect(field).toContain('deleteRange');
    expect(field).toContain("type: 'mention'");
    expect(ui).toContain('ComposerTypeaheadMenu');
    expect(source).not.toContain('thread-slash-menu');
  });

  it('seeds slash commands from the provider, installed plugin skills, and palette catalogs', () => {
    const source = readFileSync(new URL('../composer/use-composer-prompt-field.ts', import.meta.url), 'utf8');
    expect(source).toContain('commandsFromComposerActions');
    expect(source).toContain('commandsFromPluginSkills');
    expect(source).toContain('mergeCommandCatalogs');
    expect(source).toContain('filterCliComposerCommands');
    expect(source).toContain('product.threads.commands(projectId)');
    expect(source).toContain("'/plugins/contributions'");
    expect(source).toContain('product.commands.list(projectRoot ?? undefined)');
    expect(source).toContain('row.providerId === slashCatalog.providerId');
    expect(source).toContain('COMPOSER_COMMANDS_RELOAD_EVENT');
    expect(source).toContain('product.pluginApps.onChanged');
    expect(source).toContain('product.skills.onChanged');
    expect(source).not.toContain('setCommandsLoaded(false)');
  });

  it('drops files and explorer paths in as mention pills', () => {
    const source = readFileSync(new URL('../ThreadCommandComposer.tsx', import.meta.url), 'utf8');
    const field = readFileSync(new URL('../composer/use-composer-prompt-field.ts', import.meta.url), 'utf8');
    const ui = readFileSync(new URL('../composer/ComposerPromptField.tsx', import.meta.url), 'utf8');
    expect(field).toContain('droppedPathsFromDataTransfer');
    expect(field).toContain('mentionContentForDroppedPaths');
    expect(field).toContain('isComposerPathDrag');
    expect(field).toContain('handleDrop');
    expect(field).toContain('handleDOMEvents');
    expect(field).toContain('product.files.pathForFile');
    expect(field).toContain('product.fs.pickFiles');
    expect(field).toContain('droppedPathsFromAbsolutePaths');
    expect(source).toContain('is-drop-over');
    expect(source).toContain('Attach files');
    expect(source).toContain('Paperclip');
    expect(source).not.toContain('useFileDrop');
    expect(field).not.toContain('useFileDrop');

    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    expect(css).toContain('.thread-command-composer.is-drop-over .ui-command-composer');
    expect(field).toContain('handlePaste');
    expect(ui).toContain('ComposerImageThumbs');
    expect(field).toContain('imageFilesFromClipboard');
    expect(field).toContain('mentionPathsAfterImageAttach');
    expect(source).toContain('persistComposerImages');
    expect(source).toContain("type: 'localImage'");
    expect(css).toContain('.composer-image-thumbs');
    expect(css).toContain('object-fit: cover');
  });
});

describe('composer mention data sources', () => {
  it('loads confined project paths and filters commands on the client', () => {
    const hook = readFileSync(new URL('../composer/use-composer-suggestions.ts', import.meta.url), 'utf8');
    expect(hook).toContain('product.projects.paths');
    expect(hook).toContain('buildMentionSuggestions');
    expect(hook).toContain('buildCommandSuggestions');
    expect(hook).toContain('typeaheadMenuOpen');
    expect(hook).toContain('projectNames.get(thread.projectId)');
    expect(hook).toContain('mentionProviderMatchesTrigger');
    expect(hook).toContain('threadId: args.threadId');
    const composer = readFileSync(new URL('../composer/use-composer-prompt-field.ts', import.meta.url), 'utf8');
    expect(composer).toContain('composerTriggersForMentionProviders');
    expect(composer).toContain('useMentionProviderRows');
  });
});

describe('browser product client thread API', () => {
  it('persists workspace order over HTTP instead of re-listing', () => {
    const source = readFileSync(new URL('../../lib/product-client.ts', import.meta.url), 'utf8');
    expect(source).toContain('/projects/reorder');
    expect(source).not.toContain('reorder: async () => httpProduct().projects.list()');
  });

  it('exposes schedule-group subscribe so store init cannot throw', () => {
    const source = readFileSync(new URL('../../lib/product-client.ts', import.meta.url), 'utf8');
    expect(source).toContain('groups: {');
    expect(source).toContain('onChanged: noopSubscribe');
    expect(source).toContain('listTemplates: async () => []');
  });

  it('keeps thread I/O on HTTP create/send/timeline, not PTY output/resize/input', () => {
    const source = readFileSync(new URL('../../lib/product-client.ts', import.meta.url), 'utf8');
    expect(source).toContain("subscribeProductEvent('threads:event'");
    expect(source).toContain('/threads/${encodeURIComponent(threadId)}/send');
    expect(source).toContain('/threads/${encodeURIComponent(threadId)}/timeline');
    expect(source).toContain('/threads/${encodeURIComponent(threadId)}/read');
    expect(source).toContain('/conversation-outline');
    expect(source).toContain('/host-files/content');
    expect(source).toContain('voice: {');
    expect(source).toContain('/system/voice-status');
    expect(source).toContain('/system/voice-transcription');
    expect(source).toContain('/system/execution-options');
    expect(source).toContain('reasoningLevel: input.reasoningLevel');
    expect(source).toContain('ensureMicAccess: desktop?.ensureMicAccess');
    expect(source).toContain('/threads/${encodeURIComponent(threadId)}/archive');
    expect(source).toContain('/threads/${encodeURIComponent(threadId)}/plan/cancel');
    expect(source).toContain('cancelPlan:');
    expect(source).not.toContain('/threads/${encodeURIComponent(sessionId)}/output');
    expect(source).not.toContain('/threads/${encodeURIComponent(sessionId)}/resize');
    expect(source).not.toContain('/threads/${encodeURIComponent(sessionId)}/input');
    expect(source).toContain('cancelProvision');
    expect(source).not.toContain('isHostThread(sessionId)');
    expect(source).not.toContain('wrapDesktopTerminals');
    expect(source).toContain('/fs/list-dir');
    expect(source).toContain('/fs/read');
    expect(source).toContain('/paths');
    expect(source).toContain('paths: http.paths');
  });
});

describe('createTerminal uses the legacy PTY path', () => {
  it('spawns through product.terminals.create, not host-thread adapters', () => {
    const source = readFileSync(new URL('../../store.ts', import.meta.url), 'utf8');
    expect(source).toContain('product.terminals.create');
    expect(source).not.toContain('product.threads.spawn');
    expect(source).not.toContain('adoptHostThread');
    expect(source).not.toContain('hydrateHostThreads');
  });
});
