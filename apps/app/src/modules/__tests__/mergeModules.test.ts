import { afterEach, describe, expect, it } from 'vitest';
import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import { getMergedModule } from '../index.js';
import { useExtensionModules } from '../loader.js';
import { usePluginAppModules } from '../../plugins/plugin-app-loader.js';

function mod(id: string, extra: Partial<AppModule> & { loadError?: string } = {}): AppModule {
  return { id, title: id, icon: 'Box', panel: () => null, ...extra };
}

afterEach(() => {
  usePluginAppModules.getState().setModules([]);
  useExtensionModules.getState().setModules([]);
});

describe('mergeModules', () => {
  it('does not let a failed plugin app hide a working legacy extension module', () => {
    const Working = () => null;
    usePluginAppModules.getState().setModules([
      mod('gus', { loadError: 'Bundle did not default-export a plugin app.' })
    ]);
    useExtensionModules.getState().setModules([mod('gus', { panel: Working })]);

    const merged = getMergedModule('gus');
    expect(merged?.panel).toBe(Working);
    expect((merged as { loadError?: string } | undefined)?.loadError).toBeUndefined();
  });

  it('keeps a successful plugin app over a disk extension of the same id', () => {
    const PluginPanel = () => null;
    usePluginAppModules.getState().setModules([mod('tasks', { panel: PluginPanel })]);
    useExtensionModules.getState().setModules([mod('tasks')]);

    expect(getMergedModule('tasks')?.panel).toBe(PluginPanel);
  });
});
