import { describe, expect, it, vi } from 'vitest';
import { DurableWriteConflictError } from '../../config/config-store.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { DEFAULT_TERMINAL_THEME } from '@zana-ai/zcc-domain/terminal-themes';
import {
  projectOpenCodeStartupRoute,
  reconcileOpenCodeStartupRouting,
  selectOpenCodeProbeCwd,
  type OpenCodeStartupReconcileDeps
} from '../opencode-startup-reconciler.js';

const catalog = [
  { id: 'local/old', provider: 'local' },
  { id: 'local/large-model', provider: 'local' }
];

const baseConfig = (route?: AppConfig['harnessRouting']): AppConfig => ({
  version: 1,
  theme: 'dark',
  terminalTheme: DEFAULT_TERMINAL_THEME,
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
  projectViews: {},
  agentsBoardView: 'board',
  inboxGrouping: 'project',
  ...(route ? { harnessRouting: route } : {})
});

describe('projectOpenCodeStartupRoute', () => {
  it('keeps an absent or role-only route and matching provider intact', () => {
    expect(projectOpenCodeStartupRoute(undefined, ['local/old'])).toEqual({ outcome: 'no-op' });
    expect(projectOpenCodeStartupRoute({ roleTargetId: 'build' }, ['local/old']))
      .toEqual({ outcome: 'no-op', route: { roleTargetId: 'build' } });
    expect(projectOpenCodeStartupRoute({ modelTargetId: 'local/old', providerTargetId: 'local' }, ['local/old']))
      .toEqual({ outcome: 'no-op', route: { modelTargetId: 'local/old', providerTargetId: 'local' } });
    expect(projectOpenCodeStartupRoute({ modelTargetId: 'bare-model', providerTargetId: 'stale' }, ['bare-model']))
      .toEqual({ outcome: 'cleared-provider-only', route: { modelTargetId: 'bare-model' } });
  });

  it('no-ops when live already has the pinned model', () => {
    expect(projectOpenCodeStartupRoute(
      { modelTargetId: 'local/old' },
      ['local/old'],
      catalog
    )).toEqual({ outcome: 'no-op', route: { modelTargetId: 'local/old' } });
  });

  it('clears a stale model without guessing an equivalent across namespaces', () => {
    expect(projectOpenCodeStartupRoute(
      { modelTargetId: 'retired/old', providerTargetId: 'stale' },
      ['local/old'],
      catalog
    )).toEqual({
      outcome: 'cleared-stale-model',
      route: {}
    });
  });

  it('clears a stale model that has no live twin', () => {
    expect(projectOpenCodeStartupRoute(
      { modelTargetId: 'retired/gone', providerTargetId: 'local' },
      ['local/other'],
      catalog
    )).toEqual({ outcome: 'cleared-stale-model', route: {} });
  });

  it('clears a provider-only pin', () => {
    expect(projectOpenCodeStartupRoute(
      { providerTargetId: 'local' },
      ['local/old'],
      catalog
    )).toEqual({ outcome: 'cleared-provider-only', route: {} });
  });

  it('leaves role+model pins alone even when the model is gone', () => {
    expect(projectOpenCodeStartupRoute(
      { roleTargetId: 'build', modelTargetId: 'retired/gone' },
      ['local/old'],
      catalog
    )).toEqual({
      outcome: 'no-op',
      route: { roleTargetId: 'build', modelTargetId: 'retired/gone' }
    });
  });

  it('derives the provider namespace for live models absent from the static catalog', () => {
    expect(projectOpenCodeStartupRoute(
      { modelTargetId: 'local/orphan', providerTargetId: 'stale' },
      ['local/orphan'],
      catalog
    )).toEqual({
      outcome: 'remapped',
      route: { modelTargetId: 'local/orphan', providerTargetId: 'local' }
    });
  });

  it('rewrites a live model whose provider drifted', () => {
    expect(projectOpenCodeStartupRoute(
      { modelTargetId: 'local/old', providerTargetId: 'stale' },
      ['local/old'],
      catalog
    )).toEqual({
      outcome: 'remapped',
      route: { modelTargetId: 'local/old', providerTargetId: 'local' }
    });
  });

  it('does not rewrite when the live probe is unavailable', () => {
    expect(projectOpenCodeStartupRoute(
      { modelTargetId: 'retired/old' },
      undefined,
      catalog
    )).toEqual({
      outcome: 'probe-unavailable',
      route: { modelTargetId: 'retired/old' }
    });
  });
});

describe('selectOpenCodeProbeCwd', () => {
  it('prefers last local project, then first existing local, then scratch', () => {
    const projects = [
      { id: 'remote', path: '/remote', remote: { host: 'x' } },
      { id: 'gone', path: '/gone' },
      { id: 'keep', path: '/keep' }
    ];
    expect(selectOpenCodeProbeCwd({
      lastProjectId: 'keep',
      projects,
      pathExists: (path) => path === '/keep',
      ensureScratchRoot: () => '/scratch'
    })).toBe('/keep');
    expect(selectOpenCodeProbeCwd({
      lastProjectId: 'gone',
      projects,
      pathExists: (path) => path === '/keep',
      ensureScratchRoot: () => '/scratch'
    })).toBe('/keep');
    expect(selectOpenCodeProbeCwd({
      lastProjectId: 'remote',
      projects: [{ id: 'remote', path: '/remote', remote: { host: 'x' } }],
      pathExists: () => true,
      ensureScratchRoot: () => '/scratch'
    })).toBe('/scratch');
  });
});

describe('reconcileOpenCodeStartupRouting', () => {
  const snapshotOf = (config: AppConfig, hash = 'h1') => ({ config, hash });

  it('clears a stale route through CAS while preserving another adapter', async () => {
    const current = baseConfig({
      schemaVersion: 1,
      byAdapter: {
        opencode: { modelTargetId: 'retired/old' },
        claude: { modelTargetId: 'keep-claude' }
      }
    });
    const replaceConfig = vi.fn((next: AppConfig) => next);
    const deps: OpenCodeStartupReconcileDeps = {
      snapshot: () => snapshotOf(current),
      replaceConfig,
      discoverLiveModels: async () => ['local/old'],
      catalogModels: catalog
    };
    const result = await reconcileOpenCodeStartupRouting('/repo', deps);
    expect(result.outcome).toBe('cleared-stale-model');
    expect(result.config?.harnessRouting?.byAdapter).toEqual({
      claude: { modelTargetId: 'keep-claude' }
    });
    expect(replaceConfig).toHaveBeenCalledTimes(1);
  });

  it('preserves execution defaults while removing stale pins and removes empty routing', async () => {
    const deps = (route: object): OpenCodeStartupReconcileDeps => ({
      snapshot: () => snapshotOf(baseConfig({ schemaVersion: 1, byAdapter: { opencode: route } })),
      replaceConfig: next => next,
      discoverLiveModels: async () => ['local/live']
    });
    const preserved = await reconcileOpenCodeStartupRouting('/repo', deps({ modelTargetId: 'retired/gone', executionState: 'plan' }));
    expect(preserved.config?.harnessRouting?.byAdapter.opencode).toEqual({ executionState: 'plan' });
    const empty = await reconcileOpenCodeStartupRouting('/repo', deps({ modelTargetId: 'retired/gone' }));
    expect(empty.config?.harnessRouting).toBeUndefined();
  });

  it('does not write an unchanged or absent route', async () => {
    for (const config of [baseConfig(), baseConfig({ schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'local/old' } } })]) {
      const replaceConfig = vi.fn();
      await expect(reconcileOpenCodeStartupRouting('/repo', {
        snapshot: () => snapshotOf(config), replaceConfig, discoverLiveModels: async () => ['local/old']
      })).resolves.toMatchObject({ outcome: 'no-op' });
      expect(replaceConfig).not.toHaveBeenCalled();
    }
  });

  it('propagates a non-conflict error on the CAS retry', async () => {
    const boom = new Error('write failed');
    const replaceConfig = vi.fn().mockImplementationOnce(() => { throw new DurableWriteConflictError(); })
      .mockImplementationOnce(() => { throw boom; });
    await expect(reconcileOpenCodeStartupRouting('/repo', {
      snapshot: () => snapshotOf(baseConfig({ schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'retired/gone' } } })),
      replaceConfig, discoverLiveModels: async () => ['local/live']
    })).rejects.toBe(boom);
  });

  it('retries once on CAS conflict then gives up', async () => {
    const current = baseConfig({
      schemaVersion: 1,
      byAdapter: { opencode: { modelTargetId: 'retired/old' } }
    });
    const replaceConfig = vi.fn(() => {
      throw new DurableWriteConflictError();
    });
    const deps: OpenCodeStartupReconcileDeps = {
      snapshot: () => snapshotOf(current),
      replaceConfig,
      discoverLiveModels: async () => ['local/old'],
      catalogModels: catalog
    };
    await expect(reconcileOpenCodeStartupRouting('/repo', deps)).resolves.toEqual({
      outcome: 'cas-give-up'
    });
    expect(replaceConfig).toHaveBeenCalledTimes(2);
  });

  it('reuses the first live-model probe on a CAS retry', async () => {
    const current = baseConfig({
      schemaVersion: 1,
      byAdapter: { opencode: { modelTargetId: 'retired/old' } }
    });
    const discoverLiveModels = vi.fn(async () => ['local/old']);
    const replaceConfig = vi.fn(() => {
      throw new DurableWriteConflictError();
    });
    await expect(reconcileOpenCodeStartupRouting('/repo', {
      snapshot: () => snapshotOf(current),
      replaceConfig,
      discoverLiveModels,
      catalogModels: catalog
    })).resolves.toEqual({ outcome: 'cas-give-up' });
    expect(discoverLiveModels).toHaveBeenCalledTimes(1);
    expect(replaceConfig).toHaveBeenCalledTimes(2);
  });

  it('propagates a non-conflict discoverLiveModels error without retrying', async () => {
    const replaceConfig = vi.fn();
    const boom = new Error('probe exploded');
    await expect(reconcileOpenCodeStartupRouting('/repo', {
      snapshot: () => snapshotOf(baseConfig({
        schemaVersion: 1,
        byAdapter: { opencode: { modelTargetId: 'retired/old' } }
      })),
      replaceConfig,
      discoverLiveModels: async () => {
        throw boom;
      }
    })).rejects.toBe(boom);
    expect(replaceConfig).not.toHaveBeenCalled();
  });

  it('does not write when the probe is unavailable', async () => {
    const replaceConfig = vi.fn();
    const result = await reconcileOpenCodeStartupRouting('/repo', {
      snapshot: () => snapshotOf(baseConfig({
        schemaVersion: 1,
        byAdapter: { opencode: { modelTargetId: 'retired/old' } }
      })),
      replaceConfig,
      discoverLiveModels: async () => undefined
    });
    expect(result.outcome).toBe('probe-unavailable');
    expect(replaceConfig).not.toHaveBeenCalled();
  });
});
