import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

// store.ts reads `app.getPath('home')` at module-load time; mock electron to a
// throwaway tmp HOME before importing it (mirrors store.test.ts).
const h = vi.hoisted(() => ({ home: '' }));
h.home = mkdtempSync(join(tmpdir(), 'zcc-normalize-test-'));
vi.mock('electron', () => ({
  app: { getPath: () => h.home }
}));

const { normalizeConfig, normalizeProjectSettings, store } = await import('../store.js');
const { AUTO_CLOSE_IDLE_DEFAULTS, THREAD_SESSION_RELEASE_DEFAULTS } = await import('@zana-ai/zcc-domain/product');

describe('normalizeConfig — provider tiers and plugin safe mode', () => {
  it.each([true, false])('preserves explicitly configured booleans (%s)', value => {
    expect(normalizeConfig({ providerServiceTiersDisabled: value, pluginSafeMode: value })).toMatchObject({
      providerServiceTiersDisabled: value, pluginSafeMode: value
    });
  });
  it('omits malformed settings so they cannot enable a feature through coercion', () => {
    const normalized = normalizeConfig({ providerServiceTiersDisabled: 'true' as never, pluginSafeMode: 1 as never });
    expect(normalized).not.toHaveProperty('providerServiceTiersDisabled');
    expect(normalized).not.toHaveProperty('pluginSafeMode');
  });
});

describe('normalizeConfig — global Claude launch settings', () => {
  it('trims, deduplicates, and preserves supported values', () => {
    const result = normalizeConfig({
      claudeAppendSystemPrompt: '  global guidance  ',
      claudeExtraArgs: [' --verbose ', '--verbose'],
      claudeAddDirs: [' /tmp/a ', '/tmp/a'],
      claudeAllowedTools: [' Read ', 'Read'],
      claudeDeniedTools: [' Bash(rm:*) ', 'Bash(rm:*)']
    });
    expect(result.claudeAppendSystemPrompt).toBe('global guidance');
    expect(result.claudeExtraArgs).toEqual(['--verbose']);
    expect(result.claudeAddDirs).toEqual(['/tmp/a']);
    expect(result.claudeAllowedTools).toEqual(['Read']);
    expect(result.claudeDeniedTools).toEqual(['Bash(rm:*)']);
  });

  it('validates global native Codex policies', () => {
    expect(normalizeConfig({
      defaultCodexSandbox: 'workspace-write',
      defaultCodexApproval: 'on-request'
    })).toMatchObject({
      defaultCodexSandbox: 'workspace-write',
      defaultCodexApproval: 'on-request'
    });
    expect(normalizeConfig({
      defaultCodexSandbox: 'escape' as never,
      defaultCodexApproval: 'always' as never
    })).not.toHaveProperty('defaultCodexSandbox');
  });

  it('rejects non-array list values', () => {
    const result = normalizeConfig({ claudeAllowedTools: 'Read' as never });
    expect(result.claudeAllowedTools).toBeUndefined();
  });
});

describe('normalizeConfig — custom models', () => {
  it('trims, bounds, and rejects malformed overlay rows', () => {
    expect(normalizeConfig({
      customModels: [
        { providerId: ' codex ', model: ' custom/model ', displayName: ' Custom ', description: ' Local ' },
        { providerId: '', model: 'missing-provider' },
        { providerId: 'codex', model: '' }
      ]
    }).customModels).toEqual([{
      providerId: 'codex', model: 'custom/model', displayName: 'Custom', description: 'Local'
    }]);
  });
});

describe('normalizeConfig — sidebarWidth', () => {
  it('clamps to the current sidebar width as the minimum and 480 as the max', () => {
    expect(normalizeConfig({ sidebarWidth: 320 }).sidebarWidth).toBe(320);
    expect(normalizeConfig({ sidebarWidth: 320.7 }).sidebarWidth).toBe(321);
    expect(normalizeConfig({ sidebarWidth: 100 }).sidebarWidth).toBe(256);
    expect(normalizeConfig({ sidebarWidth: 900 }).sidebarWidth).toBe(480);
  });

  it('rejects non-finite values and omits an absent width', () => {
    expect(normalizeConfig({ sidebarWidth: Number.NaN }).sidebarWidth).toBeUndefined();
    expect(normalizeConfig({ sidebarWidth: Number.POSITIVE_INFINITY }).sidebarWidth).toBeUndefined();
    expect(normalizeConfig({}).sidebarWidth).toBeUndefined();
  });
});

describe('normalizeConfig — sidebar chrome', () => {
  it('keeps collapse maps, hide flags, and nav order', () => {
    expect(normalizeConfig({
      collapsedSections: { 'scheduler:groups': true, skip: 'nope' as never },
      hideIdleProjects: true,
      hideSchedulelessProjects: false,
      sidebarNavOrder: ['home', 'inbox', 'home', ''],
      projectSidebarNavOrder: ['agents']
    })).toEqual(expect.objectContaining({
      collapsedSections: { 'scheduler:groups': true },
      hideIdleProjects: true,
      hideSchedulelessProjects: false,
      sidebarNavOrder: ['home', 'inbox'],
      projectSidebarNavOrder: ['agents']
    }));
  });

  it('normalizes and bounds hidden destinations independently for each rail', () => {
    expect(normalizeConfig({
      sidebarNavHidden: [' plugin/main ', '', 'plugin/main', 42, 'x'.repeat(257)] as string[],
      projectSidebarNavHidden: ['feed']
    })).toMatchObject({ sidebarNavHidden: ['plugin/main'], projectSidebarNavHidden: ['feed'] });
    expect(normalizeConfig({ sidebarNavHidden: [], projectSidebarNavHidden: [] })).toMatchObject({
      sidebarNavHidden: [], projectSidebarNavHidden: []
    });
    expect(normalizeConfig({ sidebarNavHidden: 'invalid' as never })).not.toHaveProperty('sidebarNavHidden');
    expect(normalizeConfig({})).not.toHaveProperty('projectSidebarNavHidden');
    const ids = Array.from({ length: 250 }, (_, index) => `item-${index}`);
    expect(normalizeConfig({ projectSidebarNavHidden: ids }).projectSidebarNavHidden).toHaveLength(200);
  });
});

describe('normalizeConfig — Team organization', () => {
  it('preserves supported organization modes', () => {
    expect(normalizeConfig({
      agentsListOrganization: 'team-run',
      projectNavigationOrganization: 'team-runs',
      flowAllOrganization: 'team-runs'
    })).toMatchObject({
      agentsListOrganization: 'team-run',
      projectNavigationOrganization: 'team-runs',
      flowAllOrganization: 'team-runs'
    });
  });

  it('drops unsupported organization modes so readers use defaults', () => {
    expect(normalizeConfig({
      agentsListOrganization: 'project' as never,
      projectNavigationOrganization: 'agents' as never,
      flowAllOrganization: 'stacked' as never
    })).not.toHaveProperty('agentsListOrganization');
  });
});

describe('normalizeConfig — window state', () => {
  it('does not change omitted window state', () => {
    expect(normalizeConfig({})).not.toHaveProperty('windowBounds');
  });

  it('normalizes zoom/maximize state', () => {
    expect(normalizeConfig({ windowMaximized: true })).toMatchObject({ windowMaximized: true });
  });

  it('retains saved window state through unrelated config writes', () => {
    store.setConfig({
      windowBounds: { x: 10, y: 20, width: 1000, height: 700 }
    });
    store.setConfig({ theme: 'light' });
    expect(store.getConfig()).toMatchObject({
      windowBounds: { x: 10, y: 20, width: 1000, height: 700 }
    });
  });
});

describe('normalizeConfig — plugin view window state', () => {
  const key = 'salesforce/salesforce@p-1';

  it('does not add omitted plugin view state', () => {
    expect(normalizeConfig({})).not.toHaveProperty('pluginViewWindowBounds');
  });

  it('keeps well-formed entries, rounding and clamping to the view minimum', () => {
    expect(normalizeConfig({
      pluginViewWindowBounds: {
        [key]: { bounds: { x: 10.4, y: -3.6, width: 300, height: 1000.2 }, maximized: true, at: 12.7 }
      }
    }).pluginViewWindowBounds).toEqual({
      [key]: { bounds: { x: 10, y: -4, width: 720, height: 1000 }, maximized: true, at: 13 }
    });
  });

  it('keeps an entry that has no bounds yet and drops a false maximize flag', () => {
    expect(normalizeConfig({
      pluginViewWindowBounds: { [key]: { bounds: { width: Number.NaN, height: 1 }, maximized: false, at: 5 } }
    }).pluginViewWindowBounds).toEqual({ [key]: { at: 5 } });
  });

  it.each([
    ['a bad plugin id', 'Sales/tab@p-1'],
    ['a bad tab id', 'salesforce/a.b@p-1'],
    ['no project id', 'salesforce/tab@'],
    ['a control character in the project id', 'salesforce/tab@p\u00011'],
    ['a project id that is too long', `salesforce/tab@${'p'.repeat(257)}`]
  ])('drops a key with %s', (_label, badKey) => {
    expect(normalizeConfig({
      pluginViewWindowBounds: { [badKey]: { at: 1 }, [key]: { at: 2 } }
    }).pluginViewWindowBounds).toEqual({ [key]: { at: 2 } });
  });

  it('drops entries without a finite timestamp or with a non-object value', () => {
    expect(normalizeConfig({
      pluginViewWindowBounds: { [key]: { at: Number.POSITIVE_INFINITY }, 'salesforce/b@p-1': 'x' } as never
    })).toMatchObject({ pluginViewWindowBounds: undefined });
  });

  it.each([null, 'x', ['a']])('clears malformed state %j', (value) => {
    expect(normalizeConfig({ pluginViewWindowBounds: value as never })).toMatchObject({ pluginViewWindowBounds: undefined });
  });

  it('keeps only the 24 newest entries', () => {
    const input = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`salesforce/t${i}@p-1`, { at: i }])
    );
    const kept = normalizeConfig({ pluginViewWindowBounds: input }).pluginViewWindowBounds!;
    expect(Object.keys(kept)).toHaveLength(24);
    expect(kept['salesforce/t29@p-1']).toEqual({ at: 29 });
    expect(kept['salesforce/t5@p-1']).toBeUndefined();
  });

  it('retains plugin view state through unrelated config writes', () => {
    store.setConfig({ pluginViewWindowBounds: { [key]: { bounds: { width: 1000, height: 700 }, at: 3 } } });
    store.setConfig({ theme: 'dark' });
    expect(store.getConfig().pluginViewWindowBounds).toEqual({ [key]: { bounds: { width: 1000, height: 700 }, at: 3 } });
  });
});

describe('normalizeProjectSettings — harness routing reset', () => {
  it('removes routing when a project clears its last provider override', () => {
    expect(normalizeProjectSettings({ harnessRouting: undefined }).harnessRouting).toBeUndefined();
  });
});

describe('store.setConfig — harness routing reset', () => {
  it('removes persisted routing when the last provider/model override is cleared', () => {
    store.setConfig({
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: { opencode: { providerTargetId: 'openai' } }
      }
    });
    expect(store.getConfig().harnessRouting?.byAdapter.opencode?.providerTargetId).toBe('openai');

    store.setConfig({ harnessRouting: undefined });
    expect(store.getConfig().harnessRouting).toBeUndefined();
  });

  it('removes every optional native harness setting when explicitly cleared', () => {
    store.setConfig({
      defaultCodexSandbox: 'workspace-write',
      defaultCodexApproval: 'on-request',
      piProvider: 'anthropic',
      piModel: 'claude-sonnet',
      piThinking: 'high',
      claudeAppendSystemPrompt: 'prompt',
      claudeExtraArgs: ['--verbose'],
      defaultExecutionState: 'accept-edits'
    });
    store.setConfig({
      defaultCodexSandbox: undefined,
      defaultCodexApproval: undefined,
      piProvider: undefined,
      piModel: undefined,
      piThinking: undefined,
      claudeAppendSystemPrompt: undefined,
      claudeExtraArgs: undefined,
      defaultExecutionState: undefined
    });
    const config = store.getConfig();
    expect(config.defaultCodexSandbox).toBeUndefined();
    expect(config.defaultCodexApproval).toBeUndefined();
    expect(config.piProvider).toBeUndefined();
    expect(config.piModel).toBeUndefined();
    expect(config.piThinking).toBeUndefined();
    expect(config.claudeAppendSystemPrompt).toBeUndefined();
    expect(config.claudeExtraArgs).toBeUndefined();
    expect(config.defaultExecutionState).toBeUndefined();
  });
});

describe('normalizeConfig — mobile gateway flag', () => {
  it('passes through a boolean mobileGatewayEnabled', () => {
    expect(normalizeConfig({ mobileGatewayEnabled: true }).mobileGatewayEnabled).toBe(true);
    expect(normalizeConfig({ mobileGatewayEnabled: false }).mobileGatewayEnabled).toBe(false);
  });

  it('drops a non-boolean mobileGatewayEnabled', () => {
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ mobileGatewayEnabled: 'yes' }).mobileGatewayEnabled).toBeUndefined();
  });
});

describe('normalizeConfig — auto-close-idle flags', () => {
  it('passes through a boolean autoCloseIdleEnabled', () => {
    expect(normalizeConfig({ autoCloseIdleEnabled: true }).autoCloseIdleEnabled).toBe(true);
    expect(normalizeConfig({ autoCloseIdleEnabled: false }).autoCloseIdleEnabled).toBe(false);
  });

  it('drops a non-boolean autoCloseIdleEnabled', () => {
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ autoCloseIdleEnabled: 'yes' }).autoCloseIdleEnabled).toBeUndefined();
  });

  it('keeps an in-range autoCloseIdleMinutes (rounded)', () => {
    expect(normalizeConfig({ autoCloseIdleMinutes: 15 }).autoCloseIdleMinutes).toBe(15);
    expect(normalizeConfig({ autoCloseIdleMinutes: 15.7 }).autoCloseIdleMinutes).toBe(16);
  });

  it('clamps autoCloseIdleMinutes below the minimum', () => {
    expect(normalizeConfig({ autoCloseIdleMinutes: 0 }).autoCloseIdleMinutes).toBe(
      AUTO_CLOSE_IDLE_DEFAULTS.minMinutes
    );
    expect(normalizeConfig({ autoCloseIdleMinutes: -100 }).autoCloseIdleMinutes).toBe(
      AUTO_CLOSE_IDLE_DEFAULTS.minMinutes
    );
  });

  it('clamps autoCloseIdleMinutes above the maximum', () => {
    expect(normalizeConfig({ autoCloseIdleMinutes: 100000 }).autoCloseIdleMinutes).toBe(
      AUTO_CLOSE_IDLE_DEFAULTS.maxMinutes
    );
  });

  it('drops a non-finite autoCloseIdleMinutes', () => {
    expect(normalizeConfig({ autoCloseIdleMinutes: Number.NaN }).autoCloseIdleMinutes).toBeUndefined();
    expect(
      normalizeConfig({ autoCloseIdleMinutes: Number.POSITIVE_INFINITY }).autoCloseIdleMinutes
    ).toBeUndefined();
  });

  it('leaves both fields unset when absent (defaults apply at read time)', () => {
    const out = normalizeConfig({});
    expect(out.autoCloseIdleEnabled).toBeUndefined();
    expect(out.autoCloseIdleMinutes).toBeUndefined();
  });

  it('keeps known explorer minimap options and drops anything else', () => {
    const out = normalizeConfig({
      explorerMinimapEnabled: false,
      explorerMinimapWidth: 'wide',
      explorerMinimapRenderCharacters: false,
      explorerMinimapVerticalSize: 'fit',
      explorerMinimapSlider: 'always',
      explorerMinimapSide: 'left'
    });
    expect(out).toMatchObject({
      explorerMinimapEnabled: false,
      explorerMinimapWidth: 'wide',
      explorerMinimapRenderCharacters: false,
      explorerMinimapVerticalSize: 'fit',
      explorerMinimapSlider: 'always',
      explorerMinimapSide: 'left'
    });
    const junk = normalizeConfig({
      explorerMinimapEnabled: 'yes' as never,
      explorerMinimapWidth: 'off' as never,
      explorerMinimapRenderCharacters: 1 as never,
      explorerMinimapVerticalSize: 'huge' as never,
      explorerMinimapSlider: 3 as never,
      explorerMinimapSide: 'top' as never
    });
    for (const key of ['explorerMinimapEnabled', 'explorerMinimapWidth', 'explorerMinimapRenderCharacters', 'explorerMinimapVerticalSize', 'explorerMinimapSlider', 'explorerMinimapSide'] as const) {
      expect(junk[key]).toBeUndefined();
    }
    expect(normalizeConfig({}).explorerMinimapWidth).toBeUndefined();
  });

  it('keeps a known explorer file icon theme and drops anything else', () => {
    for (const theme of ['seti', 'minimal', 'none'] as const) {
      expect(normalizeConfig({ explorerFileIconTheme: theme }).explorerFileIconTheme).toBe(theme);
    }
    expect(normalizeConfig({ explorerFileIconTheme: 'material' as never }).explorerFileIconTheme).toBeUndefined();
    expect(normalizeConfig({ explorerFileIconTheme: 3 as never }).explorerFileIconTheme).toBeUndefined();
    expect(normalizeConfig({}).explorerFileIconTheme).toBeUndefined();
  });

  it('keeps threadSessionReleaseMinutes in range, 0 as never, and drops junk', () => {
    expect(normalizeConfig({ threadSessionReleaseMinutes: 120.4 }).threadSessionReleaseMinutes).toBe(120);
    expect(normalizeConfig({ threadSessionReleaseMinutes: 0 }).threadSessionReleaseMinutes).toBe(0);
    expect(normalizeConfig({ threadSessionReleaseMinutes: -3 }).threadSessionReleaseMinutes).toBe(0);
    expect(normalizeConfig({ threadSessionReleaseMinutes: 2 }).threadSessionReleaseMinutes).toBe(
      THREAD_SESSION_RELEASE_DEFAULTS.minMinutes
    );
    expect(normalizeConfig({ threadSessionReleaseMinutes: 1e6 }).threadSessionReleaseMinutes).toBe(
      THREAD_SESSION_RELEASE_DEFAULTS.maxMinutes
    );
    expect(normalizeConfig({ threadSessionReleaseMinutes: Number.NaN }).threadSessionReleaseMinutes).toBeUndefined();
    expect(normalizeConfig({}).threadSessionReleaseMinutes).toBeUndefined();
  });
});

describe('harness settings containers', () => {
  it('accepts only boolean native agent discovery settings', () => {
    expect(normalizeConfig({ nativeAgentDiscoveryEnabled: true }).nativeAgentDiscoveryEnabled).toBe(true);
    expect(normalizeConfig({ nativeAgentDiscoveryEnabled: false }).nativeAgentDiscoveryEnabled).toBe(false);
    expect(normalizeConfig({ nativeAgentDiscoveryEnabled: 'yes' as never }).nativeAgentDiscoveryEnabled).toBeUndefined();
  });

  it('accepts only registered agent harnesses as global defaults', () => {
    expect(normalizeConfig({ defaultHarness: 'codex' }).defaultHarness).toBe('codex');
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ defaultHarness: 'shell' }).defaultHarness).toBeUndefined();
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ defaultHarness: 'unknown' }).defaultHarness).toBeUndefined();
  });

  it('clears the global default when the compatibility default is selected', () => {
    store.setConfig({ harnessCodexEnabled: true, defaultHarness: 'codex' });
    expect(store.getConfig().defaultHarness).toBe('codex');
    store.setConfig({ defaultHarness: undefined });
    expect(store.getConfig().defaultHarness).toBeUndefined();
  });

  it('keeps a configured default when the enable flag is unset', () => {
    store.setConfig({ defaultHarness: 'opencode' });
    expect(store.getConfig().defaultHarness).toBe('opencode');
  });

  it('atomically resets the default when its harness is disabled', () => {
    store.setConfig({ harnessOpenCodeEnabled: true, defaultHarness: 'opencode' });
    expect(store.getConfig().defaultHarness).toBe('opencode');
    const next = store.setConfig({ harnessOpenCodeEnabled: false });
    expect(next.defaultHarness).toBeUndefined();
    expect(store.getConfig().defaultHarness).toBeUndefined();
  });

  it('keeps only bounded canonical global harness entries', () => {
    expect(normalizeConfig({
      harnesses: {
        byId: {
          claude: { enabled: true, binary: ' claude-dev ' },
          bogus: { enabled: true, binary: 'bad' }
        }
      } as never
    }).harnesses).toEqual({ byId: { claude: { enabled: true, binary: 'claude-dev' } } });
  });

  it('persists structured global harness model routing', () => {
    expect(normalizeConfig({
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-5.6-terra-1M' } }
      }
    }).harnessRouting).toEqual({
      schemaVersion: 1,
      byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-5.6-terra-1M' } }
    });
  });

  it('preserves legacy project settings while accepting only canonical harness container shape', () => {
    expect(normalizeProjectSettings({
      model: ' sonnet ',
      codexApproval: 'never',
      harnesses: { byId: { codex: {} } }
    })).toEqual({
      model: ' sonnet ',
      codexApproval: 'never',
      harnesses: { byId: {} }
    });
  });
});

describe('normalizeConfig — terminalWheelArrowsEnabled', () => {
  it('passes through a boolean terminalWheelArrowsEnabled', () => {
    expect(normalizeConfig({ terminalWheelArrowsEnabled: true }).terminalWheelArrowsEnabled).toBe(
      true
    );
    expect(normalizeConfig({ terminalWheelArrowsEnabled: false }).terminalWheelArrowsEnabled).toBe(
      false
    );
  });

  it('drops a non-boolean terminalWheelArrowsEnabled', () => {
    // @ts-expect-error intentional bad input (renderer is untrusted; validated in main)
    expect(normalizeConfig({ terminalWheelArrowsEnabled: 'yes' }).terminalWheelArrowsEnabled).toBeUndefined();
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ terminalWheelArrowsEnabled: 1 }).terminalWheelArrowsEnabled).toBeUndefined();
  });

  it('leaves the field unset when absent (default applies at read time)', () => {
    expect(normalizeConfig({}).terminalWheelArrowsEnabled).toBeUndefined();
  });
});

describe('normalizeConfig — terminalTheme', () => {
  it('passes through a known terminal-theme id', () => {
    expect(normalizeConfig({ terminalTheme: 'auto' }).terminalTheme).toBe('auto');
    expect(normalizeConfig({ terminalTheme: 'dracula' }).terminalTheme).toBe('dracula');
    expect(normalizeConfig({ terminalTheme: 'solarized-light' }).terminalTheme).toBe(
      'solarized-light'
    );
  });

  it('drops an unknown / malformed terminalTheme (renderer untrusted)', () => {
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ terminalTheme: 'not-a-theme' }).terminalTheme).toBeUndefined();
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ terminalTheme: 42 }).terminalTheme).toBeUndefined();
  });

  it('leaves the field unset when absent (default applies at read time)', () => {
    expect(normalizeConfig({}).terminalTheme).toBeUndefined();
  });
});

describe('normalizeConfig — theme (WARP-A2 tri-state)', () => {
  it('accepts dark / light / system', () => {
    expect(normalizeConfig({ theme: 'dark' }).theme).toBe('dark');
    expect(normalizeConfig({ theme: 'light' }).theme).toBe('light');
    expect(normalizeConfig({ theme: 'system' }).theme).toBe('system');
  });

  it('drops an unknown theme value (renderer untrusted)', () => {
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ theme: 'neon' }).theme).toBeUndefined();
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ theme: 1 }).theme).toBeUndefined();
  });

  it('leaves the field unset when absent (default applies at read time)', () => {
    expect(normalizeConfig({}).theme).toBeUndefined();
  });
});

describe('normalizeConfig — catch-up summary flags', () => {
  it('passes through a boolean catchUpSummaryEnabled', () => {
    expect(normalizeConfig({ catchUpSummaryEnabled: true }).catchUpSummaryEnabled).toBe(true);
    expect(normalizeConfig({ catchUpSummaryEnabled: false }).catchUpSummaryEnabled).toBe(false);
  });

  it('drops a non-boolean catchUpSummaryEnabled', () => {
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ catchUpSummaryEnabled: 'yes' }).catchUpSummaryEnabled).toBeUndefined();
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ catchUpSummaryEnabled: 1 }).catchUpSummaryEnabled).toBeUndefined();
  });

  it('passes through a boolean classicSessionViewEnabled, drops non-booleans', () => {
    expect(normalizeConfig({ classicSessionViewEnabled: true }).classicSessionViewEnabled).toBe(true);
    expect(normalizeConfig({ classicSessionViewEnabled: false }).classicSessionViewEnabled).toBe(false);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ classicSessionViewEnabled: 'yes' }).classicSessionViewEnabled).toBeUndefined();
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ classicSessionViewEnabled: 1 }).classicSessionViewEnabled).toBeUndefined();
  });

  it('accepts only boolean threadTabsEnabled values', () => {
    expect(normalizeConfig({ threadTabsEnabled: true }).threadTabsEnabled).toBe(true);
    expect(normalizeConfig({ threadTabsEnabled: false }).threadTabsEnabled).toBe(false);
    for (const value of ['false', 0, null, {}, []]) {
      // @ts-expect-error intentional bad input
      expect(normalizeConfig({ threadTabsEnabled: value }).threadTabsEnabled).toBeUndefined();
    }
    expect(normalizeConfig({}).threadTabsEnabled).toBeUndefined();
  });
  it('accepts only boolean dockableThreadToolsEnabled values', () => {
    expect(normalizeConfig({ dockableThreadToolsEnabled: true }).dockableThreadToolsEnabled).toBe(true);
    expect(normalizeConfig({ dockableThreadToolsEnabled: false }).dockableThreadToolsEnabled).toBe(false);
    for (const value of ['false', 0, null, {}, []]) {
      // @ts-expect-error intentional bad input
      expect(normalizeConfig({ dockableThreadToolsEnabled: value }).dockableThreadToolsEnabled).toBeUndefined();
    }
    expect(normalizeConfig({}).dockableThreadToolsEnabled).toBeUndefined();
  });

  it('passes through a boolean heldQuestionsEnabled, drops non-booleans', () => {
    expect(normalizeConfig({ heldQuestionsEnabled: true }).heldQuestionsEnabled).toBe(true);
    expect(normalizeConfig({ heldQuestionsEnabled: false }).heldQuestionsEnabled).toBe(false);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ heldQuestionsEnabled: 'yes' }).heldQuestionsEnabled).toBeUndefined();
  });

  it('keeps only valid notification levels and a boolean notificationPreviews', () => {
    expect(normalizeConfig({ notificationDefaultLevel: 'muted' }).notificationDefaultLevel).toBe('muted');
    expect(normalizeConfig({ notificationChildLevel: 'inherit' }).notificationChildLevel).toBe('inherit');
    expect(normalizeConfig({ notificationChildLevel: 'input-only' }).notificationChildLevel).toBe('input-only');
    // The global default has no inherit; the child level does.
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ notificationDefaultLevel: 'inherit' }).notificationDefaultLevel).toBeUndefined();
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ notificationDefaultLevel: 'loud' }).notificationDefaultLevel).toBeUndefined();
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ notificationChildLevel: 3 }).notificationChildLevel).toBeUndefined();
    expect(normalizeConfig({ notificationPreviews: false }).notificationPreviews).toBe(false);
    expect(normalizeConfig({ notificationPreviews: true }).notificationPreviews).toBe(true);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ notificationPreviews: 'no' }).notificationPreviews).toBeUndefined();
  });

  it('passes through a boolean feedNoiseClassifierEnabled, drops non-booleans', () => {
    expect(normalizeConfig({ feedNoiseClassifierEnabled: true }).feedNoiseClassifierEnabled).toBe(true);
    expect(normalizeConfig({ feedNoiseClassifierEnabled: false }).feedNoiseClassifierEnabled).toBe(false);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ feedNoiseClassifierEnabled: 'yes' }).feedNoiseClassifierEnabled).toBeUndefined();
  });

  it('passes through a boolean terminalCtrlVPasteEnabled, drops non-booleans and leaves it unset by default', () => {
    expect(normalizeConfig({ terminalCtrlVPasteEnabled: true }).terminalCtrlVPasteEnabled).toBe(true);
    expect(normalizeConfig({ terminalCtrlVPasteEnabled: false }).terminalCtrlVPasteEnabled).toBe(false);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ terminalCtrlVPasteEnabled: 'yes' }).terminalCtrlVPasteEnabled).toBeUndefined();
    expect(normalizeConfig({}).terminalCtrlVPasteEnabled).toBeUndefined();
  });

  it('passes through a boolean terminalClipboardWriteEnabled, drops non-booleans', () => {
    expect(normalizeConfig({ terminalClipboardWriteEnabled: true }).terminalClipboardWriteEnabled).toBe(true);
    expect(normalizeConfig({ terminalClipboardWriteEnabled: false }).terminalClipboardWriteEnabled).toBe(false);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ terminalClipboardWriteEnabled: 'yes' }).terminalClipboardWriteEnabled).toBeUndefined();
  });

  it('passes through a boolean inAppAgentTerminalsEnabled, drops non-booleans', () => {
    expect(normalizeConfig({ inAppAgentTerminalsEnabled: true }).inAppAgentTerminalsEnabled).toBe(true);
    expect(normalizeConfig({ inAppAgentTerminalsEnabled: false }).inAppAgentTerminalsEnabled).toBe(false);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ inAppAgentTerminalsEnabled: 'yes' }).inAppAgentTerminalsEnabled).toBeUndefined();
  });

  it('drops the retired cliRemoteHostCatalogEnabled flag from saved configs', () => {
    expect(normalizeConfig({ cliRemoteHostCatalogEnabled: true } as never)).not.toHaveProperty('cliRemoteHostCatalogEnabled');
  });

  it('passes through boolean composer launch-surface flags, drops non-booleans', () => {
    expect(normalizeConfig({ composerShowCliAgent: true }).composerShowCliAgent).toBe(true);
    expect(normalizeConfig({ composerShowCliAgent: false }).composerShowCliAgent).toBe(false);
    expect(normalizeConfig({ composerShowModern: true }).composerShowModern).toBe(true);
    expect(normalizeConfig({ composerShowModern: false }).composerShowModern).toBe(false);
    expect(normalizeConfig({ composerShowAutonomousTeam: true }).composerShowAutonomousTeam).toBe(true);
    expect(normalizeConfig({ composerShowAutonomousTeam: false }).composerShowAutonomousTeam).toBe(false);
    expect(normalizeConfig({ teamJobLaunchEnabled: true }).teamJobLaunchEnabled).toBe(true);
    expect(normalizeConfig({ teamJobLaunchEnabled: false }).teamJobLaunchEnabled).toBe(false);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ composerShowCliAgent: 'yes' }).composerShowCliAgent).toBeUndefined();
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ composerShowModern: 1 }).composerShowModern).toBeUndefined();
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ composerShowAutonomousTeam: 'yes' }).composerShowAutonomousTeam).toBeUndefined();
  });

  it('repairs a both-off composer launch-surface pair to all three on', () => {
    expect(normalizeConfig({
      composerShowCliAgent: false,
      composerShowModern: false
    })).toMatchObject({
      composerShowCliAgent: true,
      composerShowModern: true,
      composerShowAutonomousTeam: true,
      teamJobLaunchEnabled: true
    });
    expect(normalizeConfig({ composerShowCliAgent: false }).composerShowCliAgent).toBe(false);
    expect(normalizeConfig({ composerShowModern: false }).composerShowModern).toBe(false);
    expect(normalizeConfig({ composerLaunchSurfacesRev: 2 }).composerLaunchSurfacesRev).toBe(2);
    expect(normalizeConfig({ composerLaunchSurfacesRev: 1 }).composerLaunchSurfacesRev).toBeUndefined();
  });

  it('passes through a boolean suggestionsEnabled, drops non-booleans', () => {
    expect(normalizeConfig({ suggestionsEnabled: true }).suggestionsEnabled).toBe(true);
    expect(normalizeConfig({ suggestionsEnabled: false }).suggestionsEnabled).toBe(false);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ suggestionsEnabled: 'yes' }).suggestionsEnabled).toBeUndefined();
  });

  it('passes through a boolean trustZccToolsEnabled, drops non-booleans', () => {
    expect(normalizeConfig({ trustZccToolsEnabled: true }).trustZccToolsEnabled).toBe(true);
    expect(normalizeConfig({ trustZccToolsEnabled: false }).trustZccToolsEnabled).toBe(false);
    // @ts-expect-error intentional bad input (renderer is untrusted; validated in main)
    expect(normalizeConfig({ trustZccToolsEnabled: 'yes' }).trustZccToolsEnabled).toBeUndefined();
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ trustZccToolsEnabled: 1 }).trustZccToolsEnabled).toBeUndefined();
    // Absent ⇒ unset (the ON default is applied by store.getConfig()'s
    // fallback at read time, not by normalizeConfig).
    expect(normalizeConfig({}).trustZccToolsEnabled).toBeUndefined();
  });

  it('strips a legacy chatHarnessBackend field (allowlist normalizer, no longer a config key)', () => {
    // `opencode` is now the sole registered backend, so choosing a default is
    // meaningless — a config persisted before the `pi` backend's removal has
    // this field dropped rather than carried forward as inert noise.
    // @ts-expect-error intentional legacy field
    const out = normalizeConfig({ chatHarnessBackend: 'pi' });
    expect('chatHarnessBackend' in out).toBe(false);
  });

  it('strips a legacy chatHarnessEnabled field (allowlist normalizer, no longer a config key)', () => {
    // The multi-model engine is always available now; the retired opt-in flag is
    // not in the allowlist, so a config persisted before the removal has it
    // dropped rather than carried forward as inert noise.
    // @ts-expect-error intentional legacy field
    const out = normalizeConfig({ chatHarnessEnabled: true });
    expect('chatHarnessEnabled' in out).toBe(false);
  });

  it('keeps an in-range catchUpSummaryDelaySeconds (rounded)', () => {
    expect(normalizeConfig({ catchUpSummaryDelaySeconds: 20 }).catchUpSummaryDelaySeconds).toBe(20);
    expect(normalizeConfig({ catchUpSummaryDelaySeconds: 45.7 }).catchUpSummaryDelaySeconds).toBe(46);
  });

  it('clamps catchUpSummaryDelaySeconds below 10 seconds', () => {
    expect(normalizeConfig({ catchUpSummaryDelaySeconds: 0 }).catchUpSummaryDelaySeconds).toBe(10);
    expect(normalizeConfig({ catchUpSummaryDelaySeconds: -100 }).catchUpSummaryDelaySeconds).toBe(10);
    expect(normalizeConfig({ catchUpSummaryDelaySeconds: 5 }).catchUpSummaryDelaySeconds).toBe(10);
  });

  it('clamps catchUpSummaryDelaySeconds above 600 seconds', () => {
    expect(normalizeConfig({ catchUpSummaryDelaySeconds: 1000 }).catchUpSummaryDelaySeconds).toBe(600);
    expect(normalizeConfig({ catchUpSummaryDelaySeconds: 100000 }).catchUpSummaryDelaySeconds).toBe(600);
  });

  it('drops a non-finite catchUpSummaryDelaySeconds', () => {
    expect(normalizeConfig({ catchUpSummaryDelaySeconds: Number.NaN }).catchUpSummaryDelaySeconds).toBeUndefined();
    expect(
      normalizeConfig({ catchUpSummaryDelaySeconds: Number.POSITIVE_INFINITY }).catchUpSummaryDelaySeconds
    ).toBeUndefined();
    expect(
      normalizeConfig({ catchUpSummaryDelaySeconds: Number.NEGATIVE_INFINITY }).catchUpSummaryDelaySeconds
    ).toBeUndefined();
  });

  it('leaves both fields unset when absent (defaults apply at read time)', () => {
    const out = normalizeConfig({});
    expect(out.catchUpSummaryEnabled).toBeUndefined();
    expect(out.catchUpSummaryDelaySeconds).toBeUndefined();
  });

  it('accepts default value of 20 seconds', () => {
    expect(normalizeConfig({ catchUpSummaryDelaySeconds: 20 }).catchUpSummaryDelaySeconds).toBe(20);
  });
});

describe('normalizeConfig — worktree isolation default', () => {
  it('passes through a boolean worktreeIsolationDefault', () => {
    expect(normalizeConfig({ worktreeIsolationDefault: true }).worktreeIsolationDefault).toBe(true);
    expect(normalizeConfig({ worktreeIsolationDefault: false }).worktreeIsolationDefault).toBe(
      false
    );
  });

  it('drops a non-boolean worktreeIsolationDefault', () => {
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ worktreeIsolationDefault: 'yes' }).worktreeIsolationDefault).toBeUndefined();
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ worktreeIsolationDefault: 1 }).worktreeIsolationDefault).toBeUndefined();
  });

  it('leaves it unset when absent (default applies at read time)', () => {
    expect(normalizeConfig({}).worktreeIsolationDefault).toBeUndefined();
  });
});

describe('normalizeConfig — providerBridgeRecordingEnabled', () => {
  it('passes through a boolean, drops non-booleans', () => {
    expect(normalizeConfig({ providerBridgeRecordingEnabled: true }).providerBridgeRecordingEnabled).toBe(true);
    expect(normalizeConfig({ providerBridgeRecordingEnabled: false }).providerBridgeRecordingEnabled).toBe(false);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ providerBridgeRecordingEnabled: 'yes' }).providerBridgeRecordingEnabled).toBeUndefined();
    expect(normalizeConfig({}).providerBridgeRecordingEnabled).toBeUndefined();
  });
});

describe('normalizeConfig — lastSeenVersion (What\'s New baseline)', () => {
  it('passes through a trimmed version string', () => {
    expect(normalizeConfig({ lastSeenVersion: '1.0.4' }).lastSeenVersion).toBe('1.0.4');
    expect(normalizeConfig({ lastSeenVersion: '  1.2.3  ' }).lastSeenVersion).toBe('1.2.3');
  });

  it('drops a non-string or empty value', () => {
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ lastSeenVersion: 42 }).lastSeenVersion).toBeUndefined();
    expect(normalizeConfig({ lastSeenVersion: '   ' }).lastSeenVersion).toBeUndefined();
  });

  it('drops an over-long value (Rule 1 — bound renderer-supplied strings)', () => {
    expect(normalizeConfig({ lastSeenVersion: 'x'.repeat(65) }).lastSeenVersion).toBeUndefined();
  });
});

describe('normalizeConfig — external editor / opener overrides', () => {
  it('trims editor binary/app overrides; blank clears to undefined', () => {
    expect(normalizeConfig({ editorCursorBinary: '  /usr/local/bin/cursor  ' }).editorCursorBinary).toBe(
      '/usr/local/bin/cursor'
    );
    expect(normalizeConfig({ editorCodeApp: 'VSCodium' }).editorCodeApp).toBe('VSCodium');
    expect(normalizeConfig({ editorIntellijBinary: '   ' }).editorIntellijBinary).toBeUndefined();
    expect(normalizeConfig({ terminalApp: '  WezTerm ' }).terminalApp).toBe('WezTerm');
  });

  it('leaves editor fields unset when absent (defaults apply at open time)', () => {
    const out = normalizeConfig({});
    expect(out.editorCursorBinary).toBeUndefined();
    expect(out.editorCursorApp).toBeUndefined();
    expect(out.terminalApp).toBeUndefined();
  });

  it('passes through a boolean remoteMcpEnabled, drops non-booleans', () => {
    expect(normalizeConfig({ remoteMcpEnabled: true }).remoteMcpEnabled).toBe(true);
    expect(normalizeConfig({ remoteMcpEnabled: false }).remoteMcpEnabled).toBe(false);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ remoteMcpEnabled: 'yes' }).remoteMcpEnabled).toBeUndefined();
  });

  it('passes through a boolean enableUpdateSimulation, drops non-booleans', () => {
    expect(normalizeConfig({ enableUpdateSimulation: true }).enableUpdateSimulation).toBe(true);
    expect(normalizeConfig({ enableUpdateSimulation: false }).enableUpdateSimulation).toBe(false);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ enableUpdateSimulation: 'yes' }).enableUpdateSimulation).toBeUndefined();
  });

  it('passes through a boolean microVmEnabled, drops non-booleans', () => {
    expect(normalizeConfig({ microVmEnabled: true }).microVmEnabled).toBe(true);
    expect(normalizeConfig({ microVmEnabled: false }).microVmEnabled).toBe(false);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ microVmEnabled: 'yes' }).microVmEnabled).toBeUndefined();
  });

  it('passes through a boolean followupsFromIdle, drops non-booleans', () => {
    expect(normalizeConfig({ followupsFromIdle: true }).followupsFromIdle).toBe(true);
    expect(normalizeConfig({ followupsFromIdle: false }).followupsFromIdle).toBe(false);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ followupsFromIdle: 'yes' }).followupsFromIdle).toBeUndefined();
  });

  it('keeps only valid opener targets in openerHiddenTargets, dedupes', () => {
    expect(normalizeConfig({ openerHiddenTargets: ['finder', 'terminal'] }).openerHiddenTargets).toEqual([
      'finder',
      'terminal'
    ]);
    expect(
      // @ts-expect-error intentional bad input — bogus target dropped
      normalizeConfig({ openerHiddenTargets: ['finder', 'nope', 'finder'] }).openerHiddenTargets
    ).toEqual(['finder']);
  });

  it('clears openerHiddenTargets to undefined when empty / all-invalid', () => {
    expect(normalizeConfig({ openerHiddenTargets: [] }).openerHiddenTargets).toBeUndefined();
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ openerHiddenTargets: ['bogus'] }).openerHiddenTargets).toBeUndefined();
    // @ts-expect-error intentional bad input — non-array dropped entirely
    expect(normalizeConfig({ openerHiddenTargets: 'finder' }).openerHiddenTargets).toBeUndefined();
  });
});

describe('normalizeConfig — contentScreenMode (tri-state, mirrors overseerMode)', () => {
  it('accepts off / dryRun / on', () => {
    expect(normalizeConfig({ contentScreenMode: 'off' }).contentScreenMode).toBe('off');
    expect(normalizeConfig({ contentScreenMode: 'dryRun' }).contentScreenMode).toBe('dryRun');
    expect(normalizeConfig({ contentScreenMode: 'on' }).contentScreenMode).toBe('on');
  });

  it('drops an unknown / malformed value (renderer untrusted)', () => {
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ contentScreenMode: 'always' }).contentScreenMode).toBeUndefined();
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ contentScreenMode: 1 }).contentScreenMode).toBeUndefined();
  });

  it('leaves it unset when absent (the off default applies at read time)', () => {
    expect(normalizeConfig({}).contentScreenMode).toBeUndefined();
  });
});

describe('normalizeConfig — tmuxScope (tri-state, mirrors overseerMode)', () => {
  it('accepts off / remote / all', () => {
    expect(normalizeConfig({ tmuxScope: 'off' }).tmuxScope).toBe('off');
    expect(normalizeConfig({ tmuxScope: 'remote' }).tmuxScope).toBe('remote');
    expect(normalizeConfig({ tmuxScope: 'all' }).tmuxScope).toBe('all');
  });

  it('drops an unknown / malformed value (renderer untrusted)', () => {
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ tmuxScope: 'local' }).tmuxScope).toBeUndefined();
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ tmuxScope: true }).tmuxScope).toBeUndefined();
  });

  it('leaves it unset when absent (the "all" default applies at read time)', () => {
    expect(normalizeConfig({}).tmuxScope).toBeUndefined();
  });
});

describe('normalizeConfig — publicAppUrl and retired relay fields', () => {
  it('trims a public origin and strips a trailing slash', () => {
    expect(normalizeConfig({ publicAppUrl: ' https://zcc.herokuapp.com/ ' }).publicAppUrl).toBe(
      'https://zcc.herokuapp.com'
    );
  });

  it('clears a blank public origin and drops a non-http URL', () => {
    expect(normalizeConfig({ publicAppUrl: '   ' }).publicAppUrl).toBeUndefined();
    expect(normalizeConfig({ publicAppUrl: 'ftp://box.example' }).publicAppUrl).toBeUndefined();
    expect(normalizeConfig({ publicAppUrl: 'not a url' }).publicAppUrl).toBeUndefined();
  });

  it('drops the retired machine-relay token and session id', () => {
    const legacy = { relayToken: 'secret-token-secret', relaySessionId: 'zcrs_abcdefghijklmnopqr1234' };
    const normalized = normalizeConfig(legacy as Partial<AppConfig>);
    expect(normalized).not.toHaveProperty('relayToken');
    expect(normalized).not.toHaveProperty('relaySessionId');
  });

  it('round-trips publicAppUrl through setConfig and never persists the retired relay fields', () => {
    store.setConfig({
      publicAppUrl: 'https://zcc.herokuapp.com/',
      relayToken: 'relay-token-relay',
      relaySessionId: 'zcrs_abcdefghijklmnopqr1234'
    } as Partial<AppConfig>);
    expect(store.getConfig().publicAppUrl).toBe('https://zcc.herokuapp.com');
    expect(store.getConfig()).not.toHaveProperty('relayToken');
    expect(store.getConfig()).not.toHaveProperty('relaySessionId');
    store.setConfig({ publicAppUrl: undefined });
    expect(store.getConfig().publicAppUrl).toBeUndefined();
  });
});

describe('normalizeConfig — agent guidance', () => {
  it('aliases showDiagnosticEvents onto showUnhandledProviderEvents', () => {
    expect(normalizeConfig({ showDiagnosticEvents: true })).toMatchObject({
      showDiagnosticEvents: true,
      showUnhandledProviderEvents: true
    });
    expect(normalizeConfig({ showUnhandledProviderEvents: true })).toMatchObject({
      showDiagnosticEvents: true,
      showUnhandledProviderEvents: true
    });
  });

  it('trims unique disabledBundledSkills and drops non-arrays', () => {
    expect(normalizeConfig({
      disabledBundledSkills: [' zcc-cli ', 'zcc-cli', 'zcc-inbox']
    }).disabledBundledSkills).toEqual(['zcc-cli', 'zcc-inbox']);
    expect(normalizeConfig({ disabledBundledSkills: 'zcc-cli' as never }).disabledBundledSkills)
      .toBeUndefined();
  });
});

describe('normalizeConfig — teamDefaultCoordinationMode', () => {
  it('accepts freeform and structured', () => {
    expect(normalizeConfig({ teamDefaultCoordinationMode: 'freeform' }).teamDefaultCoordinationMode).toBe(
      'freeform'
    );
    expect(normalizeConfig({ teamDefaultCoordinationMode: 'structured' }).teamDefaultCoordinationMode).toBe(
      'structured'
    );
  });

  it('drops an unsupported coordination mode', () => {
    expect(
      // @ts-expect-error intentional bad input
      normalizeConfig({ teamDefaultCoordinationMode: 'job-team' }).teamDefaultCoordinationMode
    ).toBeUndefined();
    expect(
      // @ts-expect-error intentional bad input
      normalizeConfig({ teamDefaultCoordinationMode: 'garbage' }).teamDefaultCoordinationMode
    ).toBeUndefined();
  });

  it('leaves it unset when absent (default applies at read time)', () => {
    expect(normalizeConfig({}).teamDefaultCoordinationMode).toBeUndefined();
  });
});

describe('normalizeConfig — scheduler recovery settings', () => {
  it('rounds and clamps scheduledRunConcurrency to 1-20', () => {
    expect(normalizeConfig({ scheduledRunConcurrency: 8 }).scheduledRunConcurrency).toBe(8);
    expect(normalizeConfig({ scheduledRunConcurrency: 7.6 }).scheduledRunConcurrency).toBe(8);
    expect(normalizeConfig({ scheduledRunConcurrency: 0 }).scheduledRunConcurrency).toBe(1);
    expect(normalizeConfig({ scheduledRunConcurrency: -3 }).scheduledRunConcurrency).toBe(1);
    expect(normalizeConfig({ scheduledRunConcurrency: 500 }).scheduledRunConcurrency).toBe(20);
  });

  it('drops a non-finite or non-numeric scheduledRunConcurrency', () => {
    expect(normalizeConfig({ scheduledRunConcurrency: Number.NaN }).scheduledRunConcurrency).toBeUndefined();
    expect(normalizeConfig({ scheduledRunConcurrency: Infinity }).scheduledRunConcurrency).toBeUndefined();
    expect(normalizeConfig({ scheduledRunConcurrency: '5' as never }).scheduledRunConcurrency).toBeUndefined();
    expect(normalizeConfig({}).scheduledRunConcurrency).toBeUndefined();
  });

  it('accepts only auto | queue | skip for scheduledRunOverflow', () => {
    for (const v of ['auto', 'queue', 'skip'] as const) {
      expect(normalizeConfig({ scheduledRunOverflow: v }).scheduledRunOverflow).toBe(v);
    }
    expect(normalizeConfig({ scheduledRunOverflow: 'drop' as never }).scheduledRunOverflow).toBeUndefined();
    expect(normalizeConfig({}).scheduledRunOverflow).toBeUndefined();
  });

  it('accepts only dismissed | applied for schedulerRecoveryIntro', () => {
    expect(normalizeConfig({ schedulerRecoveryIntro: 'dismissed' }).schedulerRecoveryIntro).toBe('dismissed');
    expect(normalizeConfig({ schedulerRecoveryIntro: 'applied' }).schedulerRecoveryIntro).toBe('applied');
    expect(normalizeConfig({ schedulerRecoveryIntro: 'later' as never }).schedulerRecoveryIntro).toBeUndefined();
    expect(normalizeConfig({}).schedulerRecoveryIntro).toBeUndefined();
  });
});

describe('normalizeConfig — executionPlanStartupGraceMs', () => {
  it('keeps 0 as disabled', () => {
    expect(normalizeConfig({ executionPlanStartupGraceMs: 0 }).executionPlanStartupGraceMs).toBe(0);
  });

  it('collapses a negative value to 0 (disabled)', () => {
    expect(normalizeConfig({ executionPlanStartupGraceMs: -100 }).executionPlanStartupGraceMs).toBe(0);
  });

  it('clamps a value below the minimum up to 30_000', () => {
    expect(normalizeConfig({ executionPlanStartupGraceMs: 5_000 }).executionPlanStartupGraceMs).toBe(30_000);
  });

  it('clamps a value above the maximum down to 3_600_000', () => {
    expect(normalizeConfig({ executionPlanStartupGraceMs: 9_999_999 }).executionPlanStartupGraceMs).toBe(
      3_600_000
    );
  });

  it('keeps an in-range value (rounded)', () => {
    expect(normalizeConfig({ executionPlanStartupGraceMs: 120_000 }).executionPlanStartupGraceMs).toBe(
      120_000
    );
    expect(normalizeConfig({ executionPlanStartupGraceMs: 120_000.7 }).executionPlanStartupGraceMs).toBe(
      120_001
    );
  });

  it('leaves it unset when absent (default applies at read time)', () => {
    expect(normalizeConfig({}).executionPlanStartupGraceMs).toBeUndefined();
  });
});

describe('afcode configuration', () => {
  it('normalizes executable overrides and enablement', () => {
    expect(normalizeConfig({ afcodeBinary: '  /tmp/bin with spaces/afcode  ', harnessAfcodeEnabled: false }))
      .toMatchObject({ afcodeBinary: '/tmp/bin with spaces/afcode', harnessAfcodeEnabled: false });
    expect(normalizeConfig({ afcodeBinary: '   ' }).afcodeBinary).toBeUndefined();
    expect(normalizeConfig({ afcodeBinary: 42 as never, harnessAfcodeEnabled: 'false' as never }))
      .not.toHaveProperty('afcodeBinary');
  });
  it('round trips native settings through canonical storage', () => {
    store.setConfig({ afcodeBinary: '/tmp/afcode', harnessAfcodeEnabled: false });
    expect(store.getConfig()).toMatchObject({
      afcodeBinary: '/tmp/afcode', harnessAfcodeEnabled: false,
      harnesses: { byId: { afcode: { binary: '/tmp/afcode', enabled: false } } }
    });
    store.setConfig({ afcodeBinary: '', harnessAfcodeEnabled: true });
    expect(store.getConfig().afcodeBinary).toBeUndefined();
    expect(store.getConfig().harnesses?.byId?.afcode?.enabled).toBe(true);
  });
});

describe('normalizeConfig — thread view window state', () => {
  it('does not add omitted thread view state', () => {
    expect(normalizeConfig({})).not.toHaveProperty('threadViewWindowBounds');
  });

  it('keeps well-formed bounds, rounding and clamping to the view minimum', () => {
    expect(normalizeConfig({
      threadViewWindowBounds: { bounds: { x: 10.4, y: -3.6, width: 300, height: 1000.2 }, maximized: true }
    }).threadViewWindowBounds).toEqual({ bounds: { x: 10, y: -4, width: 720, height: 1000 }, maximized: true });
  });

  it('keeps a maximize flag without bounds and drops a false one', () => {
    expect(normalizeConfig({ threadViewWindowBounds: { maximized: true } }).threadViewWindowBounds).toEqual({ maximized: true });
    expect(normalizeConfig({
      threadViewWindowBounds: { bounds: { width: 800, height: 600 }, maximized: false }
    }).threadViewWindowBounds).toEqual({ bounds: { width: 800, height: 600 } });
  });

  it.each([null, 'x', ['a'], {}, { bounds: { width: Number.NaN, height: 1 } }])('clears malformed state %j', (value) => {
    expect(normalizeConfig({ threadViewWindowBounds: value as never })).toMatchObject({ threadViewWindowBounds: undefined });
  });

  it('retains thread view state through unrelated config writes', () => {
    store.setConfig({ threadViewWindowBounds: { bounds: { width: 1000, height: 700 } } });
    store.setConfig({ theme: 'dark' });
    expect(store.getConfig().threadViewWindowBounds).toEqual({ bounds: { width: 1000, height: 700 } });
  });
});

describe('normalizeConfig — apiErrorResume (#421)', () => {
  it('leaves the key absent for a frozen pre-#421 config', () => {
    const legacy = Object.freeze({ heartbeatEnabled: true, heartbeatDelaySeconds: 30 }) as Partial<AppConfig>;
    expect(normalizeConfig(legacy)).not.toHaveProperty('apiErrorResume');
    expect(normalizeConfig({ apiErrorResume: 'bad' as never })).not.toHaveProperty('apiErrorResume');
  });
  it('round-trips a configured value through normalize and canonicalConfigForWrite', () => {
    const apiErrorResume = {
      enabled: true,
      rules: [{ id: 'r-a', match: 'Provider anthropic not found', matchMode: 'contains', message: 'continue', delaySeconds: 20, enabled: true }],
      maxPerWindow: 3,
      windowMinutes: 15
    };
    const once = normalizeConfig({ apiErrorResume: apiErrorResume as never });
    expect(once.apiErrorResume).toEqual(apiErrorResume);
    expect(normalizeConfig(once).apiErrorResume).toEqual(apiErrorResume);
    // store.setConfig persists through canonicalConfigForWrite; the key must survive it.
    store.setConfig({ apiErrorResume: apiErrorResume as never });
    store.setConfig({ theme: 'light' });
    expect(store.getConfig().apiErrorResume).toEqual(apiErrorResume);
  });
  it('drops an invalid regex rule from a PATCH', () => {
    const out = normalizeConfig({
      apiErrorResume: { enabled: true, maxPerWindow: 3, windowMinutes: 15, rules: [
        { id: 'bad', match: '(oops', matchMode: 'regex', message: 'continue', delaySeconds: 20, enabled: true },
        { id: 'ok', match: 'rate limited', matchMode: 'contains', message: 'continue', delaySeconds: 20, enabled: true }
      ] }
    });
    expect(out.apiErrorResume!.rules.map(r => r.id)).toEqual(['ok']);
  });
});
