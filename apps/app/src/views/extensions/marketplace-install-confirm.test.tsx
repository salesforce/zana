import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { PluginInstallConfirm } from './MarketplaceView.js';

function entry(over: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    id: 'tasks',
    version: '1.0.0',
    title: 'Tasks',
    installed: false,
    hasUpdate: false,
    compatible: true,
    source: 'bundled',
    ...over
  };
}

describe('PluginInstallConfirm', () => {
  it('names the plugin and the full-trust warning', () => {
    const html = renderToStaticMarkup(
      h(PluginInstallConfirm, { entry: entry(), onCancel: () => {}, onConfirm: () => {} })
    );
    expect(html).toContain('Install Tasks?');
    expect(html).toContain('full trust');
    expect(html).toContain('Install with full trust');
    expect(html).toContain('Cancel');
    expect(html).toContain('class="modal-backdrop"');
  });

  it('lists description, contributed skills, and permission labels', () => {
    const html = renderToStaticMarkup(
      h(PluginInstallConfirm, {
        entry: entry({
          description: 'Plan and track work using a sidebar panel',
          skillNames: ['tasks'],
          permissions: ['storage']
        }),
        onCancel: () => {},
        onConfirm: () => {}
      })
    );
    expect(html).toContain('Plan and track work using a sidebar panel');
    expect(html).toContain('Skills it adds: tasks');
    expect(html).toContain('Save its own settings and data');
  });

  it('falls back to the raw permission token when no label exists', () => {
    const html = renderToStaticMarkup(
      h(PluginInstallConfirm, {
        entry: entry({ permissions: ['custom:token'] }),
        onCancel: () => {},
        onConfirm: () => {}
      })
    );
    expect(html).toContain('custom:token');
  });

  it('names contributed integration servers', () => {
    const html = renderToStaticMarkup(
      h(PluginInstallConfirm, {
        entry: entry({ mcpServers: [{ name: 'notes', alwaysOn: true }] }),
        onCancel: () => {},
        onConfirm: () => {}
      })
    );
    expect(html).toContain('Integration servers it adds: notes (always on)');
  });

  it('renders extra catalog capability lines', () => {
    const html = renderToStaticMarkup(
      h(PluginInstallConfirm, {
        entry: entry({ extra: { command: 'zcc tasks', other: { nested: true } } }),
        onCancel: () => {},
        onConfirm: () => {}
      })
    );
    expect(html).toContain('Also: command: zcc tasks');
    expect(html).toContain('Also: other');
  });
});

describe('marketplace overlay stacking', () => {
  it('install and npm dialogs use the shared Modal (portaled to document.body)', () => {
    const source = readFileSync(new URL('./MarketplaceView.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<Modal');
    expect(source).toContain('<PromptModal');
    expect(source).not.toContain('palette-backdrop');
    expect(source).toContain("creates a stacking context");
  });
});
