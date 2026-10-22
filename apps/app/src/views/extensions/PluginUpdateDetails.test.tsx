import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PluginAppEntry, PluginUpdateStatus } from '@zana-ai/zcc-domain/product';
import { PluginUpdateDetails, pluginUpdateDelivery } from './PluginUpdateDetails.js';

const plugin = { id: 'sample', sourceKind: 'git', availableVersion: '1.1.0' } as PluginAppEntry;
describe('plugin update details', () => {
  it.each([
    [undefined, 'Automatic checks; manual updates'],
    [{ sourceKind: 'builtin' }, 'Updates with Zana releases'], [{ sourceKind: 'path' }, 'Local development'],
    [{ sourceKind: 'git' }, 'Automatic checks; manual updates'],
    [{ sourceKind: 'git', updatePolicy: 'migration-required' }, 'Migration required before updating'],
    [{ sourceKind: 'git', updatePolicy: 'bundled' }, 'Updates with Zana releases']
  ] as const)('uses the host update policy for release delivery %j', (entry, text) => {
    expect(pluginUpdateDelivery(entry)).toBe(text);
  });
  it('shows a frozen legacy installation without suggesting that it can receive updates', () => {
    const html = renderToStaticMarkup(h(PluginUpdateDetails, { plugin: { ...plugin, updatePolicy: 'migration-required' } }));
    expect(html).toContain('Independent updates are blocked'); expect(html).not.toContain('has not been checked');
  });
  it.each(['builtin', 'path', undefined] as const)('omits remote status for %s', sourceKind => {
    expect(renderToStaticMarkup(h(PluginUpdateDetails, { plugin: { ...plugin, sourceKind } }))).toBe('');
  });
  it('shows never-checked state', () => {
    expect(renderToStaticMarkup(h(PluginUpdateDetails, { plugin }))).toContain('has not been checked');
  });
  it.each([
    ['available', 'Version 1.1.0'], ['current', 'installed release is current'], ['pinned', 'installation is pinned'],
    ['incompatible', 'Newer releases require'], ['unavailable', 'source could not be checked']
  ] as const)('shows %s with its last check time', (outcome, text) => {
    const updateCheck: PluginUpdateStatus = { outcome, checkedAt: 123 };
    const html = renderToStaticMarkup(h(PluginUpdateDetails, { plugin: { ...plugin, updateCheck } }));
    expect(html).toContain(text); expect(html).toContain('Last checked:');
  });
  it('shows actionable errors and incompatible release reasons', () => {
    const html = renderToStaticMarkup(h(PluginUpdateDetails, { plugin: { ...plugin, sourceKind: 'npm', updateCheck: {
      outcome: 'unavailable', checkedAt: 1, detail: 'Registry unavailable', blocked: { version: '2.0.0', reasons: ['requires Zana 9'] }
    } } }));
    expect(html).toContain('Registry unavailable'); expect(html).toContain('Release 2.0.0: requires Zana 9');
  });
});
