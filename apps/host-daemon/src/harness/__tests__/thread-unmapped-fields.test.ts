import { describe, expect, it } from 'vitest';
import type { AppConfig, ProjectSettings } from '@zana-ai/zcc-domain/product';
import { claudeLegacyRouting } from '../claude/legacy-routing.js';
import { piLegacyRouting } from '../pi/legacy-routing.js';
import { providerForFamily } from '../registry.js';

const ctx = (config: Partial<AppConfig>, projectSettings?: Partial<ProjectSettings>) => ({
  config: config as AppConfig,
  ...(projectSettings ? { projectSettings: projectSettings as ProjectSettings } : {}),
  scope: 'local' as const
});

describe('threadUnmappedFields', () => {
  it('Claude reports a project permission mode unless the profile is unrestricted', () => {
    const context = ctx({}, { permissionMode: 'bypassPermissions' });
    expect(claudeLegacyRouting.threadUnmappedFields!(context, { unrestricted: false }))
      .toEqual(['the project Claude Code permission mode (bypassPermissions)']);
    expect(claudeLegacyRouting.threadUnmappedFields!(context, { unrestricted: true })).toEqual([]);
    expect(claudeLegacyRouting.threadUnmappedFields!(ctx({}), { unrestricted: false })).toEqual([]);
  });

  it('PI reports every set global and project default, skipping the default sentinel', () => {
    expect(piLegacyRouting.threadUnmappedFields!(ctx(
      { piProvider: 'anthropic', piModel: 'm1', piThinking: 'low' } as Partial<AppConfig>,
      { piProvider: 'openai', piModel: 'm2', piThinking: 'default' }
    ), { unrestricted: false })).toEqual([
      'the global PI provider (anthropic)',
      'the global PI model (m1)',
      'the global PI thinking level (low)',
      'the project PI provider (openai)',
      'the project PI model (m2)'
    ]);
    expect(piLegacyRouting.threadUnmappedFields!(ctx({}), { unrestricted: false })).toEqual([]);
  });

  it('is wired onto the registered PI adapter and leaves launch resolution hooks unset', () => {
    const legacy = providerForFamily('pi')?.adapter.legacyRouting;
    expect(legacy).toBe(piLegacyRouting);
    expect(legacy?.resolveModel).toBeUndefined();
    expect(legacy?.resolveExecution).toBeUndefined();
  });
});
