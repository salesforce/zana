import { afterEach, describe, expect, it } from 'vitest';
import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import { getMergedModule } from '../index.js';
import { useExtensionModules } from '../loader.js';
import { usePluginAppModules } from '../../plugins/plugin-app-loader.js';

function mod(id: string, extra: Partial<AppModule> & { loadError?: string } = {}): AppModule {
  return { id, title: id, icon: 'Box', panel: () => null, ...extra };
}

afterEach(() => {
  usePluginAppModules.getState().setSnapshot([], new Set());
  useExtensionModules.getState().setModules([]);
});

describe('mergeModules', () => {
  it('does not let a failed plugin app hide a working legacy extension module', () => {
    const Working = () => null;
    usePluginAppModules.getState().setSnapshot(
      [mod('gus', { loadError: 'Bundle did not default-export a plugin app.' })],
      new Set()
    );
    useExtensionModules.getState().setModules([mod('gus', { panel: Working })]);

    const merged = getMergedModule('gus');
    expect(merged?.panel).toBe(Working);
    expect((merged as { loadError?: string } | undefined)?.loadError).toBeUndefined();
  });

  it('keeps a successful plugin app over a disk extension of the same id', () => {
    const PluginPanel = () => null;
    usePluginAppModules.getState().setSnapshot(
      [mod('tasks', { panel: PluginPanel })],
      new Set(['tasks'])
    );
    useExtensionModules.getState().setModules([mod('tasks')]);

    expect(getMergedModule('tasks')?.panel).toBe(PluginPanel);
  });

  it('hides compiled companions until their plugin app loads successfully', () => {
    expect(getMergedModule('docs')).toBeUndefined();

    usePluginAppModules.getState().setSnapshot([], new Set(['docs']));

    expect(getMergedModule('docs')?.title).toBe('Docs');
  });

  it('does not let a failed matching plugin app authorize a compiled companion', () => {
    usePluginAppModules.getState().setSnapshot(
      [mod('docs', { loadError: 'bundle exploded' })],
      new Set()
    );

    expect(getMergedModule('docs')).toMatchObject({ loadError: 'bundle exploded' });
  });

  it('keeps the compiled companion over a successful matching runtime module', () => {
    const RuntimePanel = () => null;
    usePluginAppModules.getState().setSnapshot(
      [mod('docs', { panel: RuntimePanel })],
      new Set(['docs'])
    );

    expect(getMergedModule('docs')?.panel).not.toBe(RuntimePanel);
  });

  it('does not authorize a compiled companion from an unrelated loaded id', () => {
    usePluginAppModules.getState().setSnapshot([], new Set(['tasks']));

    expect(getMergedModule('docs')).toBeUndefined();
  });
});
