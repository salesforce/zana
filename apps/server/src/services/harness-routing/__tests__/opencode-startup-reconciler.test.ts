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
  { id: 'llmgw/old', provider: 'openai' },
  { id: 'llmgw/gpt-5.6-sol-1M', provider: 'openai' }
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
  it('no-ops when live already has the pinned model', () => {
    expect(projectOpenCodeStartupRoute(
      { modelTargetId: 'llmgw/old' },
      ['llmgw/old'],
      catalog
    )).toEqual({ outcome: 'no-op', route: { modelTargetId: 'llmgw/old' } });
  });

  it('remaps aisuite/* onto a live llmgw/* twin', () => {
    expect(projectOpenCodeStartupRoute(
      { modelTargetId: 'aisuite/old', providerTargetId: 'stale' },
      ['llmgw/old'],
      catalog
    )).toEqual({
      outcome: 'remapped',
      route: { modelTargetId: 'llmgw/old', providerTargetId: 'openai' }
    });
  });

  it('clears a stale model that has no live twin', () => {
    expect(projectOpenCodeStartupRoute(
      { modelTargetId: 'aisuite/gone', providerTargetId: 'openai' },
      ['llmgw/other'],
      catalog
    )).toEqual({ outcome: 'cleared-stale-model', route: {} });
  });

  it('clears a provider-only pin', () => {
    expect(projectOpenCodeStartupRoute(
      { providerTargetId: 'openai' },
      ['llmgw/old'],
      catalog
    )).toEqual({ outcome: 'cleared-provider-only', route: {} });
  });

  it('leaves role+model pins alone even when the model is gone', () => {
    expect(projectOpenCodeStartupRoute(
      { roleTargetId: 'build', modelTargetId: 'aisuite/gone' },
      ['llmgw/old'],
      catalog
    )).toEqual({
      outcome: 'no-op',
      route: { roleTargetId: 'build', modelTargetId: 'aisuite/gone' }
    });
  });

  it('rewrites a live model whose provider drifted', () => {
    expect(projectOpenCodeStartupRoute(
      { modelTargetId: 'llmgw/old', providerTargetId: 'stale' },
      ['llmgw/old'],
      catalog
    )).toEqual({
      outcome: 'remapped',
      route: { modelTargetId: 'llmgw/old', providerTargetId: 'openai' }
    });
  });

  it('does not rewrite when the live probe is unavailable', () => {
    expect(projectOpenCodeStartupRoute(
      { modelTargetId: 'aisuite/old' },
      undefined,
      catalog
    )).toEqual({
      outcome: 'probe-unavailable',
      route: { modelTargetId: 'aisuite/old' }
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

  it('writes a remapped route through CAS', async () => {
    const current = baseConfig({
      schemaVersion: 1,
      byAdapter: {
        opencode: { modelTargetId: 'aisuite/old' },
        claude: { modelTargetId: 'keep-claude' }
      }
    });
    const replaceConfig = vi.fn((next: AppConfig) => next);
    const deps: OpenCodeStartupReconcileDeps = {
      snapshot: () => snapshotOf(current),
      replaceConfig,
      discoverLiveModels: async () => ['llmgw/old'],
      catalogModels: catalog
    };
    const result = await reconcileOpenCodeStartupRouting('/repo', deps);
    expect(result.outcome).toBe('remapped');
    expect(result.config?.harnessRouting?.byAdapter).toEqual({
      opencode: { modelTargetId: 'llmgw/old', providerTargetId: 'openai' },
      claude: { modelTargetId: 'keep-claude' }
    });
    expect(replaceConfig).toHaveBeenCalledTimes(1);
  });

  it('retries once on CAS conflict then gives up', async () => {
    const current = baseConfig({
      schemaVersion: 1,
      byAdapter: { opencode: { modelTargetId: 'aisuite/old' } }
    });
    const replaceConfig = vi.fn(() => {
      throw new DurableWriteConflictError();
    });
    const deps: OpenCodeStartupReconcileDeps = {
      snapshot: () => snapshotOf(current),
      replaceConfig,
      discoverLiveModels: async () => ['llmgw/old'],
      catalogModels: catalog
    };
    await expect(reconcileOpenCodeStartupRouting('/repo', deps)).resolves.toEqual({
      outcome: 'cas-give-up'
    });
    expect(replaceConfig).toHaveBeenCalledTimes(2);
  });

  it('does not write when the probe is unavailable', async () => {
    const replaceConfig = vi.fn();
    const result = await reconcileOpenCodeStartupRouting('/repo', {
      snapshot: () => snapshotOf(baseConfig({
        schemaVersion: 1,
        byAdapter: { opencode: { modelTargetId: 'aisuite/old' } }
      })),
      replaceConfig,
      discoverLiveModels: async () => undefined
    });
    expect(result.outcome).toBe('probe-unavailable');
    expect(replaceConfig).not.toHaveBeenCalled();
  });
});
