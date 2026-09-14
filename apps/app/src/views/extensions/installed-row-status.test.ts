import { describe, expect, it } from 'vitest';
import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
import { installedNotRunning, installedRuntimeStatus } from './installed-row-status.js';
import type { HubRow } from './installed-plugins.js';

function row(over: Partial<HubRow> & { status?: PluginAppEntry['status']; enabled?: boolean; loadError?: string }): HubRow {
  const plugin: PluginAppEntry = {
    id: 'docs',
    name: 'Docs',
    description: 'docs',
    icon: 'Library',
    enabled: over.enabled ?? true,
    provenance: 'builtin',
    status: over.status ?? 'running',
    statusDetail: over.status === 'degraded' ? 'RPC failed' : null,
    appUrl: null
  };
  return {
    module: { id: 'docs', title: 'Docs', icon: 'Library', loadError: over.loadError } as AppModule & {
      loadError?: string;
    },
    entry: null,
    plugin,
    ...over
  };
}

describe('installedRuntimeStatus', () => {
  it('surfaces failed, degraded, and needs-configuration', () => {
    expect(installedRuntimeStatus(row({ loadError: 'boom' }))).toMatchObject({
      label: 'Failed',
      tone: 'error'
    });
    expect(installedRuntimeStatus(row({ status: 'degraded' }))).toMatchObject({
      label: 'Degraded',
      tone: 'warning',
      detail: 'RPC failed'
    });
    expect(installedRuntimeStatus(row({ status: 'needs-configuration' }))?.label).toBe(
      'Needs configuration'
    );
    expect(installedRuntimeStatus(row({ status: 'running' }))).toBeNull();
  });

  it('marks enabled plugins that are not running', () => {
    expect(installedNotRunning(row({ status: 'degraded' }))).toBe(true);
    expect(installedNotRunning(row({ status: 'running' }))).toBe(false);
    expect(installedNotRunning(row({ enabled: false, status: 'disabled' }))).toBe(false);
  });

  it('keeps degraded detail for the health copy, not a second not-running chip', () => {
    expect(installedRuntimeStatus(row({ status: 'degraded' }))?.detail).toBe('RPC failed');
  });
});
