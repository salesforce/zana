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

describe('ThreadCommandComposer pinning', () => {
  it('locks to a passed project and skips the scratch default', () => {
    const source = readFileSync(new URL('../ThreadCommandComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('project: pinnedProject');
    expect(source).toContain('if (pinnedProject) setProjectId(pinnedProject.id)');
    expect(source).toContain('{!pinnedProject && (');
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
    expect(source).toContain("{threadId && (");
    expect(source).toContain('ariaLabel="Permission mode"');
    expect(source).toContain('VoiceRecordingBar');
    expect(source).toContain('Start voice input');
    expect(source).toContain('thread-command-expand');
    expect(source).toContain('Make prompt box larger');
    expect(source).toContain('onTranscript');
    expect(source).not.toContain('Queue if active');
    expect(source).not.toContain('VoiceInputButton');
    const metaIdx = source.indexOf('thread-command-composer-meta');
    expect(source.indexOf('ariaLabel="Model"')).toBeLessThan(metaIdx);
    expect(source.indexOf('<EnvironmentPicker')).toBeGreaterThan(metaIdx);
    expect(source.indexOf('ariaLabel="Permission mode"')).toBeGreaterThan(metaIdx);
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
