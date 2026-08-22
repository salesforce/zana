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

describe('HomeAgentComposer pinning', () => {
  it('locks to a passed project and skips the scratch default', () => {
    const source = readFileSync(new URL('../HomeAgentComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('{ project: pinnedProject }');
    expect(source).toContain('if (pinnedProject) return;');
    expect(source).toContain('{!pinnedProject && (');
    expect(source).toContain('setProjectId(pinnedProject.id)');
  });
});

describe('HomeAgentComposer browser launch gate', () => {
  it('keeps file attach on the desktop bridge and launches through createTerminal', () => {
    const source = readFileSync(new URL('../HomeAgentComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('hasDesktopBridge()');
    expect(source).toContain('createTerminal(');
    expect(source).toContain('openAgentModal');
    expect(source).toContain('EnvironmentPicker');
    expect(source).toContain('workspace:');
    expect(source).toContain('if (!canAttach) return;');
    expect(source).not.toContain('Launching agents requires the desktop app');
    expect(source).not.toContain('const canLaunch = hasDesktopBridge()');
  });
});

describe('browser product client scheduler stubs', () => {
  it('exposes schedule-group subscribe so store init cannot throw', () => {
    const source = readFileSync(new URL('../../lib/product-client.ts', import.meta.url), 'utf8');
    expect(source).toContain('groups: {');
    expect(source).toContain('onChanged: noopSubscribe');
    expect(source).toContain('listTemplates: async () => []');
  });

  it('forwards host terminal.output onto terminals.onData', () => {
    const source = readFileSync(new URL('../../lib/product-client.ts', import.meta.url), 'utf8');
    expect(source).toContain("subscribeProductEvent('threads:event'");
    expect(source).toContain('threadEventToTerminalData');
    expect(source).toContain('/threads/${encodeURIComponent(sessionId)}/output');
    expect(source).toContain('/threads/${encodeURIComponent(sessionId)}/resize');
    expect(source).toContain('/fs/list-dir');
    expect(source).toContain('/fs/read');
  });
});

describe('browser createTerminal uses host threads', () => {
  it('spawns a thread instead of POST /terminals', () => {
    const source = readFileSync(new URL('../../store.ts', import.meta.url), 'utf8');
    expect(source).toContain('if (!hasDesktopBridge())');
    expect(source).toContain('product.threads.spawn');
    expect(source).toContain('adoptHostThread(spawned.value)');
  });
});
