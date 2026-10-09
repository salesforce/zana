import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AppConfig, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import {
  familyEnabled,
  harnessEnablePatch,
  summarizeHarnessHealth,
  unavailableDefaultMessage
} from '@/views/settings/HarnessView';

describe('HarnessTab unavailable default', () => {
  it('preserves configured intent and explains explicit recovery choices', () => {
    const patch = harnessEnablePatch('codex', false);

    expect(patch).toEqual({ harnessCodexEnabled: false });
    expect(patch).not.toHaveProperty('defaultHarness');
    expect(unavailableDefaultMessage('codex')).toBe(
      'Default harness codex is disabled or unavailable. Defaulted launches will block until you restore it, choose another default, or clear it.'
    );
  });
});

function verifyRow(partial: Partial<HarnessVerifyResult> & Pick<HarnessVerifyResult, 'family' | 'label'>): HarnessVerifyResult {
  return {
    binary: partial.family,
    enabled: true,
    alwaysEnabled: partial.family === 'claude',
    installed: true,
    installHint: 'install',
    ...partial
  };
}

describe('summarizeHarnessHealth', () => {
  const allReady: HarnessVerifyResult[] = [
    verifyRow({ family: 'claude', label: 'Claude Code', alwaysEnabled: true }),
    verifyRow({ family: 'cursor', label: 'Cursor' }),
    verifyRow({ family: 'codex', label: 'Codex' }),
    verifyRow({ family: 'pi', label: 'PI' }),
    verifyRow({ family: 'opencode', label: 'OpenCode' })
  ];

  it('reports all ready when every family is installed and enabled', () => {
    const health = summarizeHarnessHealth(allReady, {} as AppConfig);
    expect(health).toMatchObject({ ok: true, installed: 5, enabled: 5, total: 5 });
    expect(health.message).toBe('5 installed · 5 enabled');
  });

  it('counts Claude as enabled even without a config flag', () => {
    expect(familyEnabled('claude', { harnessCursorEnabled: false } as AppConfig, false)).toBe(true);
  });

  it('treats disabled optional families as a normal preference', () => {
    const health = summarizeHarnessHealth(allReady, { harnessCursorEnabled: false } as AppConfig);
    expect(health.ok).toBe(true);
    expect(health.message).toBe('5 installed · 4 enabled');
  });

  it('reports a missing CLI', () => {
    const status = allReady.map((row) => row.family === 'codex' ? { ...row, installed: false } : row);
    const health = summarizeHarnessHealth(status, {} as AppConfig);
    expect(health.ok).toBe(false);
    expect(health.message).toBe('4 installed · 5 enabled · 1 enabled harness needs installation');
  });

  it('does not warn about missing harnesses that are switched off', () => {
    const status = allReady.map((row) => row.family === 'codex' ? { ...row, installed: false } : row);
    expect(summarizeHarnessHealth(status, { harnessCodexEnabled: false } as AppConfig))
      .toMatchObject({ ok: true, message: '4 installed · 4 enabled' });
  });

  it('pluralizes multiple enabled missing harnesses and uses probe enablement as a fallback', () => {
    const status = allReady.map((row) => ({ ...row, installed: row.family === 'claude', enabled: row.family !== 'pi' }));
    expect(summarizeHarnessHealth(status, {} as AppConfig))
      .toMatchObject({ ok: false, message: '1 installed · 4 enabled · 3 enabled harnesses need installation' });
  });

  it('returns checking when the probe has not finished', () => {
    expect(summarizeHarnessHealth([], {} as AppConfig).message).toBe('Checking…');
  });
});

describe('Install status login check copy', () => {
  it('says Check verifies sign-in for Cursor, Codex, Pi, and OpenCode', () => {
    const source = readFileSync(new URL('./HarnessView.tsx', import.meta.url), 'utf8');
    expect(source).toContain(
      'Check status refreshes installation, sign-in, and model availability.'
    );
    expect(source).toContain('login={harnessLoginStatus(h.family, modelCatalog, h.installed)}');
    expect(source).toContain('data-testid="harness-machines-link"');
    expect(source).toContain('getSettingsRoutePath(\'machines\')');
    expect(source).toContain('data-testid="harness-update-all"');
    expect(source).toContain('data-testid={`harness-cli-update-${h.family}`}');
    expect(source).toContain('cliHint={row?.status.updateUnavailableReason ?? undefined}');
    expect(source).toContain('testId={`harness-cli-hint-${h.family}`}');
    expect(source).toContain('Discover additional native agents');
    expect(source).toContain('title="Project agents"');
    expect(source).toContain("h.family === 'opencode'");
    expect(source).toContain('nativeAgentDiscoveryEnabled');
  });
});

describe('harness settings-search provider', () => {
  const rows = [
    verifyRow({ family: 'claude', label: 'Claude Code' }),
    verifyRow({ family: 'codex', label: 'Codex', installed: false })
  ];

  it('indexes name, enable switch, binary and launch defaults per family', async () => {
    const { harnessRowEntries, rememberHarnessDescriptors } = await import('@/lib/settings-search/providers/harness');
    rememberHarnessDescriptors(null);
    const entries = harnessRowEntries(rows);
    const ids = entries.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([
      'harness.claude.row', 'harness.claude.binary', 'harness.claude.default-execution-state',
      'harness.codex.row', 'harness.codex.enabled', 'harness.codex.binary'
    ]));
    // claude is always on: no enable switch; codex has no execution-state row
    expect(ids).not.toContain('harness.claude.enabled');
    expect(ids).not.toContain('harness.codex.default-execution-state');
    expect(entries.find((e) => e.id === 'harness.codex.row')?.help).toContain('Not installed');

    const snapshot = { config: { harnessCodexEnabled: false, claudeBinary: '/opt/homebrew/bin/claude' } as AppConfig };
    expect(entries.find((e) => e.id === 'harness.codex.enabled')?.value?.(snapshot)).toBe('Off');
    expect(entries.find((e) => e.id === 'harness.claude.binary')?.value?.(snapshot)).toBe('/opt/homebrew/bin/claude');
    expect(entries.find((e) => e.id === 'harness.codex.binary')?.value?.(snapshot)).toBeUndefined();
    expect(entries.find((e) => e.id === 'harness.codex.enabled')?.value?.({ config: {} as AppConfig })).toBe('On');
  });

  it('only indexes launch defaults a loaded descriptor renders', async () => {
    const { harnessRowEntries, rememberHarnessDescriptors } = await import('@/lib/settings-search/providers/harness');
    rememberHarnessDescriptors([{ id: 'claude', targets: { models: [{ id: 'm' }] } } as never]);
    const ids = harnessRowEntries([rows[0]]).map((e) => e.id);
    expect(ids).toContain('harness.claude.default-model-level');
    expect(ids).not.toContain('harness.claude.default-provider');
    expect(ids).not.toContain('harness.claude.default-execution-state');
    rememberHarnessDescriptors(null);
  });

  it('indexes Modern providers with discovered model names', async () => {
    const { threadProviderEntries, threadProviderSearchId } = await import('@/lib/settings-search/providers/harness');
    const catalog = {
      providers: [{ id: 'custom', displayName: 'Custom', permissionModes: [], composerActions: [] }],
      byProvider: { codex: { models: [{ id: 'gpt-x', displayName: 'GPT X' }] } }
    } as never;
    const entries = threadProviderEntries([{ id: 'extra', displayName: 'Extra', pluginId: 'p' }], catalog);
    const ids = entries.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([threadProviderSearchId('custom'), threadProviderSearchId('extra'), 'harness.provider.codex']));
    expect(entries.find((e) => e.id === 'harness.provider.codex')?.keywords).toEqual(expect.arrayContaining(['GPT X', 'gpt-x']));
    expect(entries.find((e) => e.id === 'harness.provider.custom')?.help).toBe('A provider for Modern conversations.');
  });

  it('registered provider reads the store without throwing', async () => {
    const { harnessSearchProvider } = await import('@/lib/settings-search/providers/harness');
    expect(harnessSearchProvider({ config: {} as AppConfig }).some((e) => e.id === 'harness.provider.claude-code')).toBe(true);
  });
});

describe('harness page entries', () => {
  it('read non-secret values from config', async () => {
    const { entries } = await import('@/lib/settings-search/entries/harness');
    const byId = (id: string) => entries.find((e) => e.id === id)!;
    const config = {
      defaultHarness: 'codex', piThinking: 'xhigh', piProvider: 'anthropic', piModel: 'm',
      claudeExtraArgs: ['--x'], defaultCodexSandbox: undefined, nativeAgentDiscoveryEnabled: false
    } as unknown as AppConfig;
    const s = { config };
    expect(byId('harness.default-harness').value?.(s)).toBe('codex');
    expect(byId('harness.default-harness').value?.({ config: {} as AppConfig })).toBe('claude');
    expect(byId('harness.pi.thinking').value?.(s)).toBe('XHigh');
    expect(byId('harness.pi.provider').value?.(s)).toBe('anthropic');
    expect(byId('harness.pi.model').value?.(s)).toBe('m');
    // Free-form CLI args are never indexed (people paste --api-key and header JSON there).
    expect(byId('harness.claude.extra-args').value).toBeUndefined();
    expect(byId('harness.opencode.discover-agents').value?.(s)).toBe('Off');
    expect(byId('harness.codex.sandbox').value?.(s)).toBeUndefined();
    expect(byId('harness.codex.approval').value?.(s)).toBeUndefined();
  });
});
