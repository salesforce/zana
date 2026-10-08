import { describe, expect, it } from 'vitest';
import { resolvePluginPanelBinding } from './plugin-panel-binding.js';
import { ThreadCreateError } from './thread-create.js';

const running = { status: (id: string) => (id === 'pr-monitor' ? 'running' as const : undefined) };

function rejection(run: () => unknown): ThreadCreateError {
  try {
    run();
  } catch (error) {
    if (error instanceof ThreadCreateError) return error;
    throw error;
  }
  throw new Error('expected a ThreadCreateError');
}

describe('resolvePluginPanelBinding', () => {
  it('is absent when the request names no plugin panel', () => {
    expect(resolvePluginPanelBinding({ projectId: 'p1' }, running)).toBeUndefined();
  });

  it('binds a running plugin with host-authored metadata', () => {
    expect(resolvePluginPanelBinding({ pluginPanel: { pluginId: ' pr-monitor ', panel: 'main' } }, running)).toEqual({
      originPluginId: 'pr-monitor',
      pluginMetadata: { panelAgent: { panel: 'main' } }
    });
  });

  it.each([
    ['caller origin', { originPluginId: 'pr-monitor' }],
    ['caller metadata', { pluginMetadata: { slackConversation: 'C1' } }],
    ['sdk origin', { origin: 'sdk' }]
  ])('refuses to mix in %s', (_label, extra) => {
    const error = rejection(() => resolvePluginPanelBinding({ pluginPanel: { pluginId: 'pr-monitor', panel: 'main' }, ...extra }, running));
    expect(error).toMatchObject({ status: 400, code: 'invalid-input' });
  });

  it.each([
    ['not an object', 'pr-monitor'],
    ['no plugin', { panel: 'main' }],
    ['reserved sdk id', { pluginId: 'sdk', panel: 'main' }],
    ['no panel', { pluginId: 'pr-monitor' }],
    ['oversized panel', { pluginId: 'pr-monitor', panel: 'x'.repeat(257) }]
  ])('rejects a malformed binding: %s', (_label, pluginPanel) => {
    expect(rejection(() => resolvePluginPanelBinding({ pluginPanel }, running))).toMatchObject({ status: 400 });
  });

  it('rejects plugins that are not running or a host without plugins', () => {
    expect(rejection(() => resolvePluginPanelBinding({ pluginPanel: { pluginId: 'gus', panel: 'main' } }, running)))
      .toMatchObject({ status: 409, code: 'plugin-unavailable' });
    expect(rejection(() => resolvePluginPanelBinding({ pluginPanel: { pluginId: 'pr-monitor', panel: 'main' } }, undefined)))
      .toMatchObject({ status: 409 });
  });
});
