import { describe, expect, it } from 'vitest';
import type { AppConfig, Persona, Project } from '@zana-ai/zcc-domain/product';
import { resolveLaunchSelection, resolveProjectDefaultSelection } from '../launch-selection.js';

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
  id: 'p1',
  name: 'Project',
  path: '/tmp/project',
  createdAt: 0,
  lastActiveAt: 0,
  ...patch
});

const resolve = (input: Partial<Parameters<typeof resolveLaunchSelection>[0]> = {}) =>
  resolveLaunchSelection({
    config: config(),
    project: project(),
    personas: [],
    requestedProfile: 'claude',
    ...input
  });

describe('resolveLaunchSelection', () => {
  it('exposes canonical project profile independently of renderer seeded persona/profile', () => {
    expect(resolveProjectDefaultSelection({
      config: config({ defaultHarness: 'opencode', harnessOpenCodeEnabled: true }),
      project: project({
        launchDefault: {
          schemaVersion: 1,
          kind: 'exact-profile',
          adapterId: 'claude',
          profileId: 'claude',
          source: 'settings'
        }
      })
    })).toMatchObject({ ok: true, profile: 'claude', source: 'project-canonical' });
  });
  it('keeps explicit profiles unchanged', () => {
    expect(resolve({ requestedProfile: 'opencode' })).toMatchObject({
      ok: true,
      profile: 'opencode',
      source: 'explicit'
    });
  });

  it('uses the global default only for seeded requests', () => {
    expect(resolve({
      config: config({
        defaultHarness: 'codex',
        harnessCodexEnabled: true,
        harnessOpenCodeEnabled: true
      }),
      requestedSource: 'seeded-default'
    })).toMatchObject({ ok: true, profile: 'codex', source: 'global-default' });
  });

  it('blocks an explicitly disabled configured default instead of falling back', () => {
    expect(resolve({
      config: config({ defaultHarness: 'codex', harnessCodexEnabled: false }),
      requestedSource: 'seeded-default'
    })).toMatchObject({ ok: false, code: 'UNAVAILABLE_DEFAULT' });
  });

  it('auto-activates a configured default when the enable flag is unset', () => {
    expect(resolve({
      config: config({ defaultHarness: 'codex' }),
      requestedSource: 'seeded-default'
    })).toMatchObject({ ok: true, profile: 'codex', source: 'global-default' });
  });

  it('uses canonical project default before global default', () => {
    expect(resolve({
      config: config({
        defaultHarness: 'codex',
        harnessCodexEnabled: true,
        harnessOpenCodeEnabled: true
      }),
      project: project({
        launchDefault: {
          schemaVersion: 1,
          kind: 'exact-profile',
          adapterId: 'opencode',
          profileId: 'opencode',
          source: 'migration'
        }
      }),
      requestedSource: 'seeded-default'
    })).toMatchObject({ ok: true, profile: 'opencode', source: 'project-canonical' });
  });

  it('uses global default when project explicitly selects use-global', () => {
    expect(resolve({
      config: config({ defaultHarness: 'opencode', harnessOpenCodeEnabled: true }),
      project: project({
        launchDefault: { schemaVersion: 1, kind: 'use-global', source: 'settings' },
        defaultAgents: ['claude']
      }),
      requestedSource: 'seeded-default'
    })).toMatchObject({ ok: true, profile: 'opencode', source: 'global-default' });
  });

  it('keeps a pinned persona and rejects conflicting explicit profile', () => {
    const persona: Persona = { id: 'reviewer', name: 'Reviewer', baseProfile: 'codex' };
    expect(resolve({
      personas: [persona],
      requestedPersonaId: persona.id,
      requestedProfile: 'claude'
    })).toMatchObject({ ok: false, code: 'PROFILE_CONFLICT' });
    expect(resolve({
      personas: [persona],
      requestedPersonaId: persona.id,
      requestedProfile: 'claude',
      requestedSource: 'seeded-default'
    })).toMatchObject({ ok: true, profile: 'codex', source: 'persona-pin' });
  });

  it('allows a resume lifecycle profile for a persona pinned to its base profile', () => {
    expect(resolve({
      requestedProfile: 'opencode-resume',
      requestedPersonaId: 'pinned-open',
      personas: [{ id: 'pinned-open', name: 'Pinned OpenCode', baseProfile: 'opencode' }]
    })).toMatchObject({
      ok: true,
      profile: 'opencode-resume',
      source: 'persona-pin'
    });
  });

  it('projects first valid legacy persona and profile entries', () => {
    const persona: Persona = { id: 'reviewer', name: 'Reviewer', baseProfile: 'pi' };
    expect(resolve({
      personas: [persona],
      project: project({ defaultPersonas: ['stale', persona.id] }),
      requestedSource: 'seeded-default'
    })).toMatchObject({ ok: true, profile: 'pi', personaId: persona.id, source: 'project-legacy' });
    expect(resolve({
      project: project({ defaultAgents: ['stale', 'opencode'] }),
      requestedSource: 'seeded-default'
    })).toMatchObject({ ok: true, profile: 'opencode', source: 'project-legacy' });
  });

  it('uses adapter-owned compatibility fallback metadata', () => {
    expect(resolve({ requestedSource: 'seeded-default' })).toMatchObject({
      ok: true,
      profile: 'claude',
      source: 'adapter-compatibility'
    });
  });
});
