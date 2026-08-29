import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// store.ts reads `app.getPath('home')` at module-load time; mock electron to a
// throwaway tmp HOME before importing it (mirrors store.test.ts).
const h = vi.hoisted(() => ({ home: '' }));
h.home = mkdtempSync(join(tmpdir(), 'zcc-normalize-test-'));
vi.mock('electron', () => ({
  app: { getPath: () => h.home }
}));

const { normalizeConfig, normalizeProjectSettings, store } = await import('../store.js');
const { AUTO_CLOSE_IDLE_DEFAULTS } = await import('../../shared/types.js');

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
});

describe('harness settings containers', () => {
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

  it('passes through a boolean heldQuestionsEnabled, drops non-booleans', () => {
    expect(normalizeConfig({ heldQuestionsEnabled: true }).heldQuestionsEnabled).toBe(true);
    expect(normalizeConfig({ heldQuestionsEnabled: false }).heldQuestionsEnabled).toBe(false);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ heldQuestionsEnabled: 'yes' }).heldQuestionsEnabled).toBeUndefined();
  });

  it('passes through a boolean feedNoiseClassifierEnabled, drops non-booleans', () => {
    expect(normalizeConfig({ feedNoiseClassifierEnabled: true }).feedNoiseClassifierEnabled).toBe(true);
    expect(normalizeConfig({ feedNoiseClassifierEnabled: false }).feedNoiseClassifierEnabled).toBe(false);
    // @ts-expect-error intentional bad input
    expect(normalizeConfig({ feedNoiseClassifierEnabled: 'yes' }).feedNoiseClassifierEnabled).toBeUndefined();
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
