import { describe, expect, it } from 'vitest';
import type { AppConfig, HarnessVerifyResult, Project } from '@zana-ai/zcc-domain/product';
import { resolveEffectiveHarnessDefault } from '../effective-default.js';

const config = (patch: Partial<AppConfig> = {}): AppConfig => ({
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
  ...patch
});

const project = (patch: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'Project', path: '/tmp/project', createdAt: 0, lastActiveAt: 0, ...patch
});

const available = (...families: HarnessVerifyResult['family'][]): HarnessVerifyResult[] =>
  (['claude', 'cursor', 'codex', 'pi', 'opencode'] as const).map((family) => ({
    family,
    label: family,
    binary: family,
    enabled: family === 'claude' || families.includes(family),
    alwaysEnabled: family === 'claude',
    installed: family === 'claude' || families.includes(family),
    installHint: ''
  }));

describe('resolveEffectiveHarnessDefault', () => {
  it('returns NOT_FOUND without a registered project', () => {
    expect(resolveEffectiveHarnessDefault({ project: undefined, config: config(), personas: [], availability: available() }))
      .toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('keeps exact canonical project profile and family', () => {
    expect(resolveEffectiveHarnessDefault({
      project: project({ launchDefault: { schemaVersion: 1, kind: 'exact-profile', adapterId: 'claude', profileId: 'claude-yolo', source: 'settings' } }),
      config: config(), personas: [], availability: available()
    })).toEqual({ ok: true, profile: 'claude-yolo', family: 'claude', source: 'project-canonical' });
  });

  it('uses installed global default when project selects use-global', () => {
    expect(resolveEffectiveHarnessDefault({
      project: project({ launchDefault: { schemaVersion: 1, kind: 'use-global', source: 'settings' } }),
      config: config({ defaultHarness: 'opencode', harnessOpenCodeEnabled: true }), personas: [], availability: available('opencode')
    })).toEqual({ ok: true, profile: 'opencode', family: 'opencode', source: 'global-default' });
  });

  it('rejects a configured default whose binary is missing', () => {
    expect(resolveEffectiveHarnessDefault({
      project: project({ launchDefault: { schemaVersion: 1, kind: 'use-global', source: 'settings' } }),
      config: config({ defaultHarness: 'opencode', harnessOpenCodeEnabled: true }), personas: [], availability: available()
    })).toMatchObject({ ok: false, code: 'UNAVAILABLE_DEFAULT' });
  });
});
