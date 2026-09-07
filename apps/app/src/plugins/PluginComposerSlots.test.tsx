import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { PluginComposerAdvanced, PluginComposerMeta } from './PluginComposerSlots.js';
import { clearPluginSlots, interpretPluginApp } from './plugin-slots.js';

describe('PluginComposerSlots', () => {
  it('mounts matching meta chips and advanced fields for cli-agent', () => {
    clearPluginSlots('harness-claude');
    interpretPluginApp(
      'harness-claude',
      definePluginApp((app) => {
        app.composer.customize({
          id: 'chip',
          scopes: ['cli-agent'],
          meta: [{ id: 'chip', component: () => <span data-testid="cli-meta-chip">Chip</span> }],
          advanced: [{ id: 'extra', component: () => <span>plugin advanced</span> }]
        });
      })
    );

    expect(
      renderToStaticMarkup(<PluginComposerMeta scope={{ kind: 'cli-agent', projectId: 'p' }} />)
    ).toContain('cli-meta-chip');
    expect(
      renderToStaticMarkup(<PluginComposerMeta scope={{ kind: 'new-thread', projectId: 'p' }} />)
    ).not.toContain('cli-meta-chip');
    expect(
      renderToStaticMarkup(<PluginComposerAdvanced scope={{ kind: 'cli-agent', projectId: 'p' }} />)
    ).toContain('plugin advanced');

    clearPluginSlots('harness-claude');
  });
});
