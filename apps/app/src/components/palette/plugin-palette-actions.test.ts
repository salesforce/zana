import { describe, expect, it, vi } from 'vitest';
import { collectPluginApp, definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { buildPluginPaletteItems } from './plugin-palette-actions.js';

describe('buildPluginPaletteItems', () => {
  it('lists available plugin actions and runs them', () => {
    const run = vi.fn();
    const set = collectPluginApp(
      'pr-monitor',
      1,
      definePluginApp((app) => {
        app.slots.commandPaletteAction({
          id: 'open',
          title: 'Open PR Monitor',
          run
        });
        app.slots.commandPaletteAction({
          id: 'hidden',
          title: 'Hidden',
          isAvailable: () => false,
          run: () => undefined
        });
      })
    );
    const items = buildPluginPaletteItems(set.commandPaletteActions, { threadId: null, projectId: null }, () => undefined);
    expect(items.map((row) => row.key)).toEqual(['plugin:pr-monitor/open']);
    expect(items[0]?.label).toBe('Open PR Monitor');
    items[0]?.run();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('omits a row whose isAvailable throws', () => {
    const set = collectPluginApp(
      'pr-monitor',
      1,
      definePluginApp((app) => {
        app.slots.commandPaletteAction({
          id: 'boom',
          title: 'Boom',
          isAvailable: () => {
            throw new Error('nope');
          },
          run: () => undefined
        });
      })
    );
    expect(
      buildPluginPaletteItems(set.commandPaletteActions, { threadId: null, projectId: null }, () => undefined)
    ).toEqual([]);
  });
});
