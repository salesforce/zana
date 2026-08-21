import { describe, expect, it } from 'vitest';
import { claudeLegacyRouting } from '../claude/legacy-routing.js';
import { codexLegacyRouting } from '../codex/legacy-routing.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

const config: AppConfig = { version: 1, theme: 'dark', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null };

describe('harness-local legacy routing', () => {
  it('keeps Claude historical model fields inside the Claude adapter', () => {
    expect(claudeLegacyRouting.resolveModel?.({
      config: { ...config, defaultModel: 'sonnet' },
      persona: { id: 'p', name: 'P', model: 'opus' },
      scope: 'local'
    }, 'persona')).toEqual({ targetId: 'opus' });
    expect(claudeLegacyRouting.resolveModel?.({ config: { ...config, defaultModel: 'sonnet' }, scope: 'local' }, 'global'))
      .toEqual({ targetId: 'sonnet' });
  });

  it('renders and audits Codex compatibility tuples without generic Codex logic', () => {
    const value = { codexSandbox: 'workspace-write', codexApproval: 'on-request' };
    expect(codexLegacyRouting.validateCompatibility?.(value)).toBe(true);
    const selection = codexLegacyRouting.resolveCompatibilityExecution?.(value);
    expect(selection).toMatchObject({
      targetId: 'codex.native.workspace-write+on-request',
      contribution: { args: ['-s', 'workspace-write', '-a', 'on-request'] }
    });
    expect(codexLegacyRouting.auditExecution?.(selection!)).toBeUndefined();
    expect(codexLegacyRouting.validateCompatibility?.({ codexSandbox: 'unsafe' })).toBe(false);
  });
});
