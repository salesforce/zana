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
  it('wraps the thread composer so Home keeps its dashboard spacing', () => {
    const source = readFileSync(new URL('../HomeAgentComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('className="home-agent-composer"');
    expect(source).toContain('<ThreadCommandComposer');
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
    expect(editor).not.toContain('min-height: 80px;');
    expect(editor).not.toContain('max-height: 70dvh;');

    const threadComposer = css.slice(
      css.indexOf('.thread-detail-column {'),
      css.indexOf('.thread-detail-header {')
    );
    expect(threadComposer).toContain('max-width: 46rem;');
    expect(threadComposer).toContain('justify-self: center;');
    expect(threadComposer).toContain('flex: 0 0 auto;');
    const timeline = css.slice(
      css.indexOf('.thread-detail-timeline {'),
      css.indexOf('.thread-timeline-turn {')
    );
    expect(timeline).not.toContain('max-width:');
    expect(timeline).not.toContain('margin-inline:');

    const wide = css.slice(
      css.indexOf('@media (min-width: 1280px) {'),
      css.indexOf('.thread-detail-header {')
    );
    expect(wide).toContain('max-width: 52rem;');
    expect(wide).toContain('min-height: 52px;');
    expect(wide).toContain('max-height: 16rem;');
  });
});

describe('ThreadCommandComposer initial text', () => {
  it('seeds the TipTap editor once from initialText', () => {
    const source = readFileSync(new URL('../ThreadCommandComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('initialText?: string');
    expect(source).toContain('initialText,');
    expect(source).toContain('seededInitialText');
    expect(source).toContain('editor.chain().insertContent(initialText).run()');
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
    expect(source).toContain('DEFAULT_COMPOSER_WORKSPACE_LABEL');
    expect(source).toContain('composerProjectLabel');
    expect(source).not.toContain('{!pinnedProject && (');
    expect(source).not.toContain('projects[0]!');
  });
});

describe('ThreadCommandComposer submit path', () => {
  it('creates and follows up through the Thread HTTP API', () => {
    const source = readFileSync(new URL('../ThreadCommandComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('product.threads.create');
    expect(source).toContain('serializePromptEditor');
    expect(source).toContain('mentions: serialized.mentions');
    expect(source).toContain('Enter a message first');
    expect(source).toContain('Could not send message');
    expect(source).toContain('permissionMode: permissionMode as');
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
    expect(source).toContain('threadId && shouldShowThreadStop(threadId, status)');
    expect(source).toContain('data-testid="thread-command-stop"');
    expect(source).toContain('className="thread-command-stop"');
    expect(source).toContain('fill="currentColor"');
    expect(source).toContain('ariaLabel="Permission mode"');
    expect(source).toContain('VoiceRecordingBar');
    expect(source).toContain('Start voice input');
    expect(source).toContain('thread-command-expand');
    expect(source).toContain('Make prompt box larger');
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
    expect(source).toContain('reasoningLevel: options.reasoningLevel');
    expect(source).toContain('moreModelOptions={options.moreModelOptions}');
    expect(source).toContain('applyComposerModePrefix');
    expect(source).toContain('nextComposerWorkMode');
    expect(source).toContain("event.key !== 'Tab'");
    expect(source.indexOf('<EnvironmentPicker')).toBeGreaterThan(metaIdx);
    expect(source.indexOf('ariaLabel="Permission mode"')).toBeGreaterThan(metaIdx);

    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    const stopStart = css.indexOf('.thread-command-composer .thread-command-stop {');
    expect(stopStart).toBeGreaterThan(-1);
    expect(css.slice(stopStart, css.indexOf('}', stopStart))).toContain('color: var(--danger);');
  });

  it('steals typeahead keys while the menu is open and inserts mention pills', () => {
    const source = readFileSync(new URL('../ThreadCommandComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('typeaheadKeyAction');
    expect(source).toContain('ComposerTypeaheadMenu');
    expect(source).toContain('PromptMentionExtension');
    expect(source).toContain('deleteRange');
    expect(source).toContain("type: 'mention'");
    expect(source).not.toContain('thread-slash-menu');
  });
});

describe('composer mention data sources', () => {
  it('loads confined project paths and filters commands on the client', () => {
    const hook = readFileSync(new URL('../composer/use-composer-suggestions.ts', import.meta.url), 'utf8');
    expect(hook).toContain('product.projects.paths');
    expect(hook).toContain('buildMentionSuggestions');
    expect(hook).toContain('buildCommandSuggestions');
    expect(hook).toContain('typeaheadMenuOpen');
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
