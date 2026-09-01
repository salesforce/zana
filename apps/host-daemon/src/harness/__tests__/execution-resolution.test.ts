import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { providerFor } from '../registry.js';
import { resolveExecutionState } from '../target-resolution.js';

const config = (patch: Partial<AppConfig> = {}): AppConfig => ({
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
  ...patch
});

describe('execution-state resolution', () => {
  it('resolves execution routing through Agent > Persona > Project > Global precedence', () => {
    const global = {
      schemaVersion: 1 as const,
      byAdapter: { opencode: { executionState: 'plan' as const } }
    };
    const project = {
      schemaVersion: 1 as const,
      byAdapter: { opencode: { executionState: 'interactive' as const } }
    };
    const persona = { id: 'p', name: 'P', executionState: 'accept-edits' as const };
    const agent = {
      schemaVersion: 1 as const,
      byAdapter: { opencode: { executionState: 'autonomous' as const } }
    };
    const resolve = (overrides: Record<string, unknown> = {}) => resolveExecutionState(providerFor('opencode'), {
      config: config({ harnessRouting: global }),
      profile: 'opencode',
      extraArgs: [],
      ...overrides
    });

    expect(resolve()).toMatchObject({ source: 'Global', state: 'plan' });
    expect(resolve({ projectSettings: { harnessRouting: project } })).toMatchObject({
      source: 'Project', state: 'interactive'
    });
    expect(resolve({ projectSettings: { harnessRouting: project }, persona })).toMatchObject({
      source: 'Persona', state: 'accept-edits'
    });
    expect(resolve({ projectSettings: { harnessRouting: project }, persona, perTabRouting: agent })).toMatchObject({
      source: 'Agent', state: 'autonomous'
    });
  });

  it('returns explicit execution provenance, stable target, equivalence, and consent', () => {
    const portable = resolveExecutionState(providerFor('opencode'), {
      config: config(), profile: 'opencode', extraArgs: [],
      persona: { id: 'p', name: 'P', executionState: 'accept-edits' }
    });
    expect(portable).toMatchObject({
      origin: 'portable-mapped', source: 'Persona', targetId: 'opencode.execution.accept-edits',
      equivalence: 'closest', consentRequired: true,
      contribution: { args: ['--auto'] }
    });

    const pinned = resolveExecutionState(providerFor('opencode'), {
      config: config(), profile: 'opencode', extraArgs: [],
      perTabRouting: { schemaVersion: 1, byAdapter: { opencode: { executionTargetId: 'opencode.execution.accept-edits' } } }
    });
    expect(pinned).toMatchObject({
      origin: 'explicit-native', source: 'Agent', targetId: 'opencode.execution.accept-edits',
      equivalence: 'closest', consentRequired: false
    });

    expect(resolveExecutionState(providerFor('opencode'), {
      config: config(), profile: 'opencode', extraArgs: []
    })).toMatchObject({
      origin: 'inherited-native-default', source: 'native-default', consentRequired: false
    });
  });

  it('uses portable persona state before project and global defaults', () => {
    const resolved = resolveExecutionState(providerFor('claude'), {
      config: config({ defaultExecutionState: 'plan' }),
      profile: 'claude',
      extraArgs: [],
      persona: { id: 'p', name: 'P', executionState: 'accept-edits' },
      projectSettings: { executionState: 'autonomous' }
    });
    expect(resolved.source).toBe('Persona');
    expect(resolved.contribution.args).toEqual(['--permission-mode', 'acceptEdits']);
  });

  it('uses concrete persona harness execution state before portable intent', () => {
    const resolved = resolveExecutionState(providerFor('claude'), {
      config: config(),
      profile: 'claude',
      extraArgs: [],
      persona: {
        id: 'p',
        name: 'P',
        baseProfile: 'claude',
        executionState: 'plan',
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: { claude: { executionState: 'accept-edits' } }
        }
      }
    });

    expect(resolved.source).toBe('Persona');
    expect(resolved.state).toBe('accept-edits');
    expect(resolved.contribution.args).toEqual(['--permission-mode', 'acceptEdits']);
  });

  it('prefers harness-specific project execution state over interim generic state', () => {
    const resolved = resolveExecutionState(providerFor('claude'), {
      config: config(),
      profile: 'claude',
      extraArgs: [],
      projectSettings: {
        executionState: 'plan',
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: { claude: { executionState: 'accept-edits' } }
        }
      }
    });
    expect(resolved.contribution.args).toEqual(['--permission-mode', 'acceptEdits']);
  });

  it('maps OpenCode accept-edits to build plus auto-approve', () => {
    const resolved = resolveExecutionState(providerFor('opencode'), {
      config: config({ defaultExecutionState: 'accept-edits' }),
      profile: 'opencode',
      extraArgs: []
    });
    expect(resolved.contribution.args).toEqual(['--auto']);
  });

  it('maps Cursor autonomous to force', () => {
    const resolved = resolveExecutionState(providerFor('cursor'), {
      config: config({ defaultExecutionState: 'autonomous' }),
      profile: 'cursor',
      extraArgs: []
    });
    expect(resolved.contribution.args).toEqual(['--force']);
  });

  it('blocks unsupported explicit Persona and Global execution state', () => {
    expect(() => resolveExecutionState(providerFor('pi'), {
      config: config({ defaultExecutionState: 'plan' }),
      profile: 'pi',
      extraArgs: []
    })).toThrow('PI does not support plan execution state.');
    expect(() => resolveExecutionState(providerFor('pi'), {
      config: config(),
      profile: 'pi',
      extraArgs: [],
      persona: { id: 'p', name: 'P', executionState: 'plan' }
    })).toThrow('PI does not support plan execution state.');
  });

  it('maps a portable Persona state to both Codex policy dimensions', () => {
    const resolved = resolveExecutionState(providerFor('codex'), {
      config: config(), profile: 'codex', extraArgs: [],
      projectSettings: { codexSandbox: 'read-only', codexApproval: 'untrusted' },
      persona: { id: 'p', name: 'P', executionState: 'autonomous' }
    });
    expect(resolved.source).toBe('Persona');
    expect(resolved.contribution.args).toEqual(['-s', 'danger-full-access', '-a', 'never']);
  });

  it('honors validated native Codex policy overrides at Agent precedence', () => {
    const resolved = resolveExecutionState(providerFor('codex'), {
      config: config(),
      profile: 'codex',
      extraArgs: [],
      persona: { id: 'p', name: 'P', executionState: 'plan' },
      perTabRouting: {
        schemaVersion: 1,
        byAdapter: {
          codex: { compatibility: { codexSandbox: 'workspace-write', codexApproval: 'never' } }
        }
      }
    });
    expect(resolved.source).toBe('Agent');
    expect(resolved.contribution.args).toEqual(['-s', 'workspace-write', '-a', 'never']);
  });

  it.each([
    ['-s', 'read-only'],
    ['-sread-only'],
    ['--sandbox', 'read-only'],
    ['--sandbox=read-only'],
    ['-a', 'never'],
    ['-anever'],
    ['--ask-for-approval', 'never'],
    ['--ask-for-approval=never'],
    ['--dangerously-bypass-approvals-and-sandbox']
  ])('rejects native Codex Agent policy colliding with raw execution args %j', (...extraArgs) => {
    expect(() => resolveExecutionState(providerFor('codex'), {
      config: config(),
      profile: 'codex',
      extraArgs,
      perTabRouting: {
        schemaVersion: 1,
        byAdapter: { codex: { compatibility: { codexSandbox: 'workspace-write' } } }
      }
    })).toThrow('Compatibility execution policy conflicts with raw execution arguments.');
  });

  it('rejects unknown native Codex Agent policies', () => {
    expect(() => resolveExecutionState(providerFor('codex'), {
      config: config(),
      profile: 'codex',
      extraArgs: [],
      perTabRouting: {
        schemaVersion: 1,
        byAdapter: { codex: { compatibility: { codexSandbox: 'escape' } } }
      }
    })).toThrow('Invalid structured model routing request.');
    expect(() => resolveExecutionState(providerFor('claude'), {
      config: config(),
      profile: 'claude',
      extraArgs: [],
      perTabRouting: {
        schemaVersion: 1,
        byAdapter: { claude: { compatibility: { codexApproval: 'never' } } }
      }
    })).toThrow('Invalid structured model routing request.');
  });

  it('rejects malformed per-tab execution routing', () => {
    expect(() => resolveExecutionState(providerFor('claude'), {
      config: config(),
      profile: 'claude',
      extraArgs: [],
      perTabRouting: { schemaVersion: 1, byAdapter: { claude: { executionState: 'bogus' as never } } }
    })).toThrow('Invalid structured model routing request.');
  });

  it('ignores inherited execution on unrestricted profiles but rejects same-request Agent execution', () => {
    for (const profile of ['claude-yolo', 'codex-yolo'] as const) {
      const family = profile === 'claude-yolo' ? 'claude' : 'codex';
      expect(resolveExecutionState(providerFor(profile), {
        config: config({ defaultExecutionState: 'plan' }), profile, extraArgs: [],
        persona: { id: 'p', name: 'P', executionState: 'interactive' },
        projectSettings: { executionState: 'accept-edits' }
      })).toMatchObject({ origin: 'explicit-native', source: 'native-default', consentRequired: false });
      expect(() => resolveExecutionState(providerFor(profile), {
        config: config(),
        profile,
        extraArgs: [],
        perTabRouting: {
          schemaVersion: 1,
          byAdapter: { [family]: { executionState: 'plan' } }
        }
      })).toThrow('Structured execution state conflicts with unrestricted profile.');
    }
  });

  it('uses persona-pinned profile posture for execution conflicts', () => {
    expect(resolveExecutionState(providerFor('claude-yolo'), {
      config: config({ defaultExecutionState: 'plan' }),
      profile: 'claude',
      extraArgs: [],
      persona: { id: 'p', name: 'P', baseProfile: 'claude-yolo' }
    })).toMatchObject({ origin: 'explicit-native', source: 'native-default', contribution: {} });
  });

  it.each([
    ['opencode', ['--agent', 'build']],
    ['opencode', ['--agent=build']],
    ['opencode', ['--auto']],
    ['cursor', ['--mode', 'plan']],
    ['cursor', ['--mode=plan']],
    ['cursor', ['--force']],
    ['codex', ['-s', 'read-only']],
    ['codex', ['-sread-only']],
    ['codex', ['--ask-for-approval', 'never']],
    ['codex', ['--ask-for-approval=never']],
    ['claude', ['--permission-mode', 'plan']],
    ['claude', ['--permission-mode=plan']],
    ['claude', ['--dangerously-skip-permissions']]
  ] as const)('blocks %s structured execution colliding with raw native flags', (profile, extraArgs) => {
    const family = profile;
    expect(() => resolveExecutionState(providerFor(profile), {
      config: config(), profile, extraArgs: [...extraArgs],
      perTabRouting: {
        schemaVersion: 1,
        byAdapter: { [family]: { executionState: 'plan' } }
      }
    })).toThrow('Structured execution state conflicts with raw execution arguments.');
  });

  it('stops execution collision parsing at --', () => {
    expect(resolveExecutionState(providerFor('claude'), {
      config: config(), profile: 'claude', extraArgs: ['--', '--permission-mode=autonomous'],
      perTabRouting: { schemaVersion: 1, byAdapter: { claude: { executionState: 'plan' } } }
    }).contribution.args).toEqual(['--permission-mode', 'plan']);
  });

  it('uses Persona native Codex policy over Project portable state as one effective tuple', () => {
    const resolved = resolveExecutionState(providerFor('codex'), {
      config: config(), profile: 'codex', extraArgs: [],
      persona: { id: 'p', name: 'P', codexSandbox: 'workspace-write', codexApproval: 'never' },
      projectSettings: { executionState: 'plan' }
    });
    expect(resolved).toMatchObject({ source: 'Persona', origin: 'legacy-compatibility', consentRequired: false });
    expect(resolved.nativePolicy).toEqual({ codexSandbox: 'workspace-write', codexApproval: 'never' });
    expect(resolved.contribution.args).toEqual(['-s', 'workspace-write', '-a', 'never']);
  });

  it('keeps legacy Codex compatibility subject to native-policy collision safety', () => {
    expect(() => resolveExecutionState(providerFor('codex'), {
      config: config(), profile: 'codex', extraArgs: ['--sandbox', 'read-only'],
      persona: { id: 'p', name: 'P', codexSandbox: 'workspace-write' }
    })).toThrow('Compatibility execution policy conflicts with raw execution arguments.');
  });

  it('uses Project native Codex policy over Global portable state as one effective tuple', () => {
    const resolved = resolveExecutionState(providerFor('codex'), {
      config: config({ defaultExecutionState: 'plan' }), profile: 'codex', extraArgs: [],
      projectSettings: { codexSandbox: 'workspace-write', codexApproval: 'never' }
    });
    expect(resolved).toMatchObject({ source: 'Project', origin: 'legacy-compatibility' });
    expect(resolved.nativePolicy).toEqual({ codexSandbox: 'workspace-write', codexApproval: 'never' });
  });
});
