import { describe, it, expect } from 'vitest';
import type { Persona, Project } from '../../../shared/types.js';
import {
  knownProfile,
  projectDefaultProfile,
  projectDefaultLaunch
} from '../launchProfile.js';

function project(over: Partial<Project>): Project {
  return {
    id: 'p1',
    name: 'p1',
    path: '/work/p1',
    createdAt: 0,
    lastActiveAt: 0,
    ...over
  };
}

function persona(over: Partial<Persona>): Persona {
  return { id: 'reviewer', name: 'Reviewer', ...over };
}

describe('knownProfile', () => {
  it('narrows known profile ids, rejects personas/unknowns', () => {
    expect(knownProfile('claude')).toBe('claude');
    expect(knownProfile('shell')).toBe('shell');
    expect(knownProfile('reviewer')).toBeUndefined();
    expect(knownProfile(undefined)).toBeUndefined();
  });
});

describe('projectDefaultProfile', () => {
  it('uses defaultAgents[0] when it is a known profile, else claude', () => {
    expect(projectDefaultProfile(project({ defaultAgents: ['claude-yolo'] }))).toBe('claude-yolo');
    expect(projectDefaultProfile(project({ defaultAgents: ['reviewer'] }))).toBe('claude');
    expect(projectDefaultProfile(project({}))).toBe('claude');
  });
});

describe('projectDefaultLaunch', () => {
  const personas = [
    persona({ id: 'reviewer', baseProfile: 'claude' }),
    persona({ id: 'yolo-bot', baseProfile: 'claude-yolo' }),
    persona({ id: 'no-base' }) // no baseProfile → defaults to claude
  ];

  it('launches the pinned default persona on its own baseProfile', () => {
    expect(projectDefaultLaunch(project({ defaultPersonas: ['yolo-bot'] }), personas)).toEqual({
      profile: 'claude-yolo',
      personaId: 'yolo-bot'
    });
  });

  it('defaults a base-less persona to the claude profile', () => {
    expect(projectDefaultLaunch(project({ defaultPersonas: ['no-base'] }), personas)).toEqual({
      profile: 'claude',
      personaId: 'no-base'
    });
  });

  it('falls through to the profile default when no persona is pinned', () => {
    expect(projectDefaultLaunch(project({ defaultAgents: ['claude-yolo'] }), personas)).toEqual({
      profile: 'claude-yolo'
    });
    expect(projectDefaultLaunch(project({}), personas)).toEqual({ profile: 'claude' });
  });

  it('falls through (no personaId) when the pinned persona no longer resolves', () => {
    // Stale id — file deleted since it was pinned. Must not dead-end the "+".
    expect(projectDefaultLaunch(project({ defaultPersonas: ['ghost'] }), personas)).toEqual({
      profile: 'claude'
    });
  });

  it('a pinned persona wins over a defaultAgents profile', () => {
    const p = project({ defaultPersonas: ['reviewer'], defaultAgents: ['shell'] });
    expect(projectDefaultLaunch(p, personas)).toEqual({ profile: 'claude', personaId: 'reviewer' });
  });
});
