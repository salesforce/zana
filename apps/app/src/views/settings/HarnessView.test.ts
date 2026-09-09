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
    expect(health.message).toBe('All 5 installed and enabled');
  });

  it('counts Claude as enabled even without a config flag', () => {
    expect(familyEnabled('claude', { harnessCursorEnabled: false } as AppConfig, false)).toBe(true);
  });

  it('names a disabled optional family', () => {
    const health = summarizeHarnessHealth(allReady, { harnessCursorEnabled: false } as AppConfig);
    expect(health.ok).toBe(false);
    expect(health.message).toContain('Cursor is off');
  });

  it('reports a missing CLI', () => {
    const status = allReady.map((row) => row.family === 'codex' ? { ...row, installed: false } : row);
    const health = summarizeHarnessHealth(status, {} as AppConfig);
    expect(health.ok).toBe(false);
    expect(health.message).toContain('4 of 5 installed');
  });

  it('returns checking when the probe has not finished', () => {
    expect(summarizeHarnessHealth([], {} as AppConfig).message).toBe('Checking…');
  });
});

describe('Install status login check copy', () => {
  it('says Check verifies sign-in for Cursor, Codex, Pi, and OpenCode', () => {
    const source = readFileSync(new URL('./HarnessView.tsx', import.meta.url), 'utf8');
    expect(source).toContain(
      'whether Cursor, Codex, Pi, and OpenCode are signed in'
    );
    expect(source).toContain('login={harnessLoginStatus(h.family, modelCatalog, h.installed)}');
    expect(source).toContain('data-testid="harness-machines-link"');
    expect(source).toContain('getSettingsRoutePath(\'machines\')');
    expect(source).toContain('data-testid="harness-update-all"');
    expect(source).toContain('data-testid={`harness-cli-update-${h.family}`}');
    expect(source).toContain('cliHint={row?.status.updateUnavailableReason ?? undefined}');
    expect(source).toContain('testId={`harness-cli-hint-${h.family}`}');
  });
});
