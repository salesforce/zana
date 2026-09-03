import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { providerFor } from '../registry.js';
import { resolveModelTarget, resolveRoleTarget } from '../target-resolution.js';

const config = (): AppConfig => ({
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
});

describe('target-resolution main authorization', () => {
  const opencode = providerFor('opencode');

  it('resolves model routing through Agent > Persona > Project > Global precedence', () => {
    const global = {
      schemaVersion: 1 as const,
      byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-5.6-luna-1M' } }
    };
    const project = {
      schemaVersion: 1 as const,
      byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-5.6-terra-1M' } }
    };
    const persona = { id: 'p', name: 'P', modelLevel: 'high' as const };
    const agent = {
      schemaVersion: 1 as const,
      byAdapter: { opencode: { modelTargetId: 'llmgw/gemini-3.5-flash' } }
    };
    const resolve = (overrides: Record<string, unknown> = {}) => resolveModelTarget(opencode, {
      config: { ...config(), harnessRouting: global },
      profile: 'opencode',
      extraArgs: [],
      scope: 'local',
      ...overrides
    });

    expect(resolve()).toMatchObject({ source: 'global', targetId: 'llmgw/gpt-5.6-luna-1M' });
    expect(resolve({ projectSettings: { harnessRouting: project } })).toMatchObject({
      source: 'project', targetId: 'llmgw/gpt-5.6-terra-1M'
    });
    expect(resolve({ projectSettings: { harnessRouting: project }, persona })).toMatchObject({
      source: 'persona', targetId: 'llmgw/gpt-5.6-sol-1M'
    });
    expect(resolve({ projectSettings: { harnessRouting: project }, persona, perTabRouting: agent })).toMatchObject({
      source: 'per-tab', targetId: 'llmgw/gemini-3.5-flash'
    });
  });

  it('uses a concrete persona harness model target before portable intent', () => {
    const resolved = resolveModelTarget(opencode, {
      config: config(),
      profile: 'opencode',
      extraArgs: [],
      scope: 'local',
      persona: {
        id: 'p',
        name: 'P',
        baseProfile: 'opencode',
        modelLevel: 'low',
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-5.6-sol-1M' } }
        }
      }
    });

    expect(resolved).toMatchObject({
      source: 'persona',
      targetId: 'llmgw/gpt-5.6-sol-1M',
      structuredSelected: true
    });
  });

  it('rejects malformed renderer routing before resolving a target', () => {
    expect(() => resolveModelTarget(opencode, {
      config: config(),
      profile: 'opencode',
      extraArgs: [],
      perTabRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: '' } } },
      scope: 'local'
    })).toThrow('Invalid structured model routing request.');
  });

  it('rejects remote model targets when adapter metadata does not support them', () => {
    expect(() => resolveModelTarget(opencode, {
      config: config(),
      profile: 'opencode',
      extraArgs: [],
      perTabRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-5.6-terra-1M' } } },
      scope: 'remote'
    })).toThrow('model target is unavailable for remote launches');
  });

  it('only emits native arguments from a trusted catalog target', () => {
    const resolved = resolveModelTarget(opencode, {
      config: config(),
      profile: 'opencode',
      extraArgs: [],
      perTabRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-5.6-terra-1M' } } },
      scope: 'local'
    });
    expect(resolved.contribution.args).toEqual(['--model', 'llmgw/gpt-5.6-terra-1M']);
  });

  it('validates provider target as a filter over the effective combined model target', () => {
    expect(() => resolveModelTarget(opencode, {
      config: config(), profile: 'opencode', extraArgs: [], scope: 'local',
      perTabRouting: {
        schemaVersion: 1,
        byAdapter: {
          opencode: { providerTargetId: 'google', modelTargetId: 'llmgw/gpt-5.6-sol-1M' }
        }
      }
    })).toThrow('model target does not belong to selected provider');
  });

  it('resolves provider routing through Agent > Persona > Project > Global precedence', () => {
    const resolved = resolveModelTarget(opencode, {
      config: {
        ...config(),
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: { opencode: { providerTargetId: 'google', modelTargetId: 'llmgw/gemini-3.5-flash' } }
        }
      },
      profile: 'opencode',
      extraArgs: [],
      scope: 'local',
      projectSettings: {
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: { opencode: { providerTargetId: 'xai', modelTargetId: 'llmgw/grok-4.6' } }
        }
      },
      persona: {
        id: 'p',
        name: 'P',
        baseProfile: 'opencode',
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: { opencode: { providerTargetId: 'openai', modelTargetId: 'llmgw/gpt-5.6-sol-1M' } }
        }
      }
    });

    expect(resolved).toMatchObject({
      source: 'persona',
      providerTargetId: 'openai',
      targetId: 'llmgw/gpt-5.6-sol-1M'
    });
  });

  it('requires a concrete compatible model for combined provider/model selection', () => {
    expect(() => resolveModelTarget(opencode, {
      config: config(),
      profile: 'opencode',
      extraArgs: [],
      scope: 'local',
      perTabRouting: {
        schemaVersion: 1,
        byAdapter: { opencode: { providerTargetId: 'openai' } }
      }
    })).toThrow('requires a concrete compatible model target');
  });

  it('uses persona model level instead of an obsolete exact persona target', () => {
    const resolved = resolveModelTarget(opencode, {
      config: config(),
      profile: 'opencode',
      extraArgs: [],
      persona: {
        id: 'test',
        name: 'Test',
        modelLevel: 'high',
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: { opencode: { modelTargetId: 'llmgw/gemini-3.1-pro-preview' } }
        }
      },
      scope: 'local'
    });
    expect(resolved.targetId).toBe('llmgw/gpt-5.6-sol-1M');
    expect(resolved.contribution.args).toEqual(['--model', 'llmgw/gpt-5.6-sol-1M']);
  });

  it('maps one portable project model level through the selected harness', () => {
    const resolved = resolveModelTarget(opencode, {
      config: config(),
      profile: 'opencode',
      extraArgs: [],
      projectSettings: { modelLevel: 'high' },
      scope: 'local'
    });
    expect(resolved.source).toBe('project');
    expect(resolved.targetId).toBe('llmgw/gpt-5.6-sol-1M');
  });

  it.each([
    ['cursor', 'low'],
    ['cursor', 'extra-high'],
    ['opencode', 'extra-high'],
    ['pi', 'low'],
    ['pi', 'medium'],
    ['pi', 'high'],
    ['pi', 'extra-high']
  ] as const)('fails closed when %s has no explicit %s model-level mapping', (profile, modelLevel) => {
    expect(() => resolveModelTarget(providerFor(profile), {
      config: config(),
      profile,
      extraArgs: [],
      perTabRouting: {
        schemaVersion: 1,
        byAdapter: { [profile]: { modelLevel } }
      },
      scope: 'local'
    })).toThrow(`does not support ${modelLevel} model level`);
  });

  it('prefers harness-specific project model over interim generic project level', () => {
    const resolved = resolveModelTarget(opencode, {
      config: config(),
      profile: 'opencode',
      extraArgs: [],
      projectSettings: {
        modelLevel: 'low',
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-5.6-sol-1M' } }
        }
      },
      scope: 'local'
    });
    expect(resolved.targetId).toBe('llmgw/gpt-5.6-sol-1M');
  });

  it('prefers portable persona model over project model', () => {
    const resolved = resolveModelTarget(opencode, {
      config: config(), profile: 'opencode', extraArgs: [], scope: 'local',
      projectSettings: { modelLevel: 'low' },
      persona: { id: 'p', name: 'P', modelLevel: 'high' }
    });
    expect(resolved.source).toBe('persona');
    expect(resolved.targetId).toBe('llmgw/gpt-5.6-sol-1M');
  });

  it('keeps neutral legacy concrete Persona and Project models on Claude/Codex adapters', () => {
    for (const profile of ['opencode', 'cursor', 'pi'] as const) {
      expect(resolveModelTarget(providerFor(profile), {
        config: config(), profile, extraArgs: [], scope: 'local',
        persona: { id: 'p', name: 'P', model: 'legacy-persona-model' },
        projectSettings: { model: 'legacy-project-model' }
      }).targetId).toBeUndefined();
    }
    expect(resolveModelTarget(providerFor('claude'), {
      config: config(), profile: 'claude', extraArgs: [], scope: 'local',
      persona: { id: 'p', name: 'P', model: 'opus' }
    }).targetId).toBe('opus');
    expect(resolveModelTarget(providerFor('codex'), {
      config: config(), profile: 'codex', extraArgs: [], scope: 'local',
      projectSettings: { model: 'gpt-4o' }
    }).targetId).toBe('gpt-4o');
  });

  it('rejects persona role targets outside adapter-owned scope', () => {
    expect(() => resolveRoleTarget(opencode, {
      config: config(),
      profile: 'opencode',
      extraArgs: [],
      persona: {
        id: 'test',
        name: 'Test',
        baseProfile: 'opencode',
        harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { roleTargetId: 'custom-agent' } } }
      },
      scope: 'remote'
    })).toThrow('role target is unavailable for remote launches');
  });

  it('applies adapter-scoped role target from a neutral Persona after harness selection', () => {
    expect(resolveRoleTarget(opencode, {
      config: config(), profile: 'opencode', extraArgs: [], scope: 'local',
      persona: {
        id: 'neutral', name: 'Neutral',
        harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { roleTargetId: 'custom-agent' } } }
      }
    })).toMatchObject({ source: 'Persona', targetId: 'custom-agent', contribution: { args: ['--agent', 'custom-agent'] } });
  });

  it('uses neutral persona role targets only after owning adapter is selected', () => {
    expect(resolveRoleTarget(opencode, {
      config: config(),
      profile: 'opencode',
      extraArgs: [],
      persona: {
        id: 'test',
        name: 'Test',
        harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { roleTargetId: 'custom-agent' } } }
      },
      scope: 'local'
    })).toMatchObject({ source: 'Persona', targetId: 'custom-agent', contribution: { args: ['--agent', 'custom-agent'] } });
  });

  it('accepts a live-listed Pi model id when the adapter catalog is empty', () => {
    const resolved = resolveModelTarget(providerFor('pi'), {
      config: config(),
      profile: 'pi',
      extraArgs: [],
      perTabRouting: {
        schemaVersion: 1,
        byAdapter: { pi: { modelTargetId: 'openai/gpt-5.2' } }
      },
      scope: 'local'
    });
    expect(resolved).toMatchObject({
      source: 'per-tab',
      targetId: 'openai/gpt-5.2',
      structuredSelected: true,
      contribution: { args: ['--model', 'openai/gpt-5.2'] }
    });
  });

  it('rejects a flag-shaped Pi model id that is not in a static catalog', () => {
    expect(() => resolveModelTarget(providerFor('pi'), {
      config: config(),
      profile: 'pi',
      extraArgs: [],
      perTabRouting: {
        schemaVersion: 1,
        byAdapter: { pi: { modelTargetId: '--model' } }
      },
      scope: 'local'
    })).toThrow('Unknown model target');
  });

  it('still rejects an unknown model on adapters that own a static catalog', () => {
    expect(() => resolveModelTarget(providerFor('claude'), {
      config: config(),
      profile: 'claude',
      extraArgs: [],
      perTabRouting: {
        schemaVersion: 1,
        byAdapter: { claude: { modelTargetId: 'openai/gpt-5.2' } }
      },
      scope: 'local'
    })).toThrow('Unknown model target');
  });

  it('rejects structured Codex model selection combined with raw short model flag', () => {
    expect(() => resolveModelTarget(providerFor('codex'), {
      config: config(),
      profile: 'codex',
      extraArgs: ['-m', 'gpt-5'],
      perTabRouting: { schemaVersion: 1, byAdapter: { codex: { modelTargetId: 'gpt-4o' } } },
      scope: 'local'
    })).toThrow('conflicts with raw --model arguments');
  });

  it('rejects structured role selection combined with split or attached native role flags', () => {
    const persona = {
      id: 'p',
      name: 'P',
      baseProfile: 'opencode' as const,
      harnessRouting: { schemaVersion: 1 as const, byAdapter: { opencode: { roleTargetId: 'custom-agent' } } }
    };
    for (const extraArgs of [['--agent', 'build'], ['--agent=build']]) {
      expect(() => resolveRoleTarget(opencode, {
        config: config(), profile: 'opencode', extraArgs, persona, scope: 'local'
      })).toThrow('Structured role selection conflicts with raw role arguments.');
    }
  });

  it('does not treat native role flags after -- as structured collisions', () => {
    expect(resolveRoleTarget(opencode, {
      config: config(),
      profile: 'opencode',
      extraArgs: ['--', '--agent=build'],
      persona: {
        id: 'p', name: 'P',
        baseProfile: 'opencode',
        harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { roleTargetId: 'custom-agent' } } }
      },
      scope: 'local'
    }).contribution.args).toEqual(['--agent', 'custom-agent']);
  });
});
