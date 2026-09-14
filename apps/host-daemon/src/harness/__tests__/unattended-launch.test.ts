import { describe, expect, it } from 'vitest';
import {
  applyUnattendedScheduledLaunch,
  effectiveUnattendedProfile,
  profilePostureOf,
  unattendedExecutionRouting,
  unrestrictedSiblingOf
} from '../unattended-launch.js';

describe('unattended scheduled launch policy', () => {
  it('maps each default-posture agent profile to its unrestricted sibling', () => {
    expect(unrestrictedSiblingOf('claude')).toBe('claude-yolo');
    expect(unrestrictedSiblingOf('cursor')).toBe('cursor-yolo');
    expect(unrestrictedSiblingOf('codex')).toBe('codex-yolo');
    expect(unrestrictedSiblingOf('opencode')).toBe('opencode-yolo');
    expect(unrestrictedSiblingOf('grok')).toBe('grok-yolo');
    expect(unrestrictedSiblingOf('mastracode')).toBe('mastracode-yolo');
    expect(unrestrictedSiblingOf('shell')).toBeUndefined();
    expect(unrestrictedSiblingOf('pi')).toBeUndefined();
  });

  it('scheduled default-posture identity remaps to yolo for argv', () => {
    expect(effectiveUnattendedProfile('claude', undefined, { scheduled: true })).toBe('claude-yolo');
    expect(effectiveUnattendedProfile('cursor', undefined, { scheduled: true })).toBe('cursor-yolo');
    expect(effectiveUnattendedProfile('grok', undefined, { scheduled: true })).toBe('grok-yolo');
  });

  it('scheduled resume keeps the resume profile', () => {
    expect(effectiveUnattendedProfile('claude-resume', undefined, { scheduled: true })).toBe('claude-resume');
    expect(profilePostureOf('claude-resume')).toBe('resume');
  });

  it('autonomous Claude (including resume) still remaps to yolo', () => {
    expect(effectiveUnattendedProfile('claude', undefined, { autonomous: true })).toBe('claude-yolo');
    expect(effectiveUnattendedProfile('claude-resume', undefined, { autonomous: true })).toBe('claude-yolo');
  });

  it('a prompting persona cannot keep a scheduled Claude run on the default base', () => {
    expect(effectiveUnattendedProfile('claude', {
      id: 'p', name: 'P', baseProfile: 'claude', permissionMode: 'plan'
    }, { scheduled: true })).toBe('claude-yolo');
  });

  it('overlays autonomous execution routing when the adapter supports it', () => {
    expect(unattendedExecutionRouting('claude')).toEqual({
      schemaVersion: 1,
      byAdapter: { claude: { executionState: 'autonomous' } }
    });
    expect(unattendedExecutionRouting('cursor')?.byAdapter.cursor).toEqual({ executionState: 'autonomous' });
    expect(unattendedExecutionRouting('grok')).toBeUndefined();
  });

  it('preserves an existing model target when overlaying execution', () => {
    const overlay = unattendedExecutionRouting('claude', {
      schemaVersion: 1,
      byAdapter: { claude: { modelTargetId: 'opus' } }
    });
    expect(overlay?.byAdapter.claude).toEqual({
      modelTargetId: 'opus',
      executionState: 'autonomous'
    });
  });

  it('applyUnattendedScheduledLaunch remaps default-posture profiles onto yolo', () => {
    const claude = applyUnattendedScheduledLaunch({ profile: 'claude' as const, scheduled: true });
    expect(claude.profile).toBe('claude-yolo');
    expect(claude.harnessRouting).toBeUndefined();

    const grok = applyUnattendedScheduledLaunch({ profile: 'grok' as const, scheduled: true });
    expect(grok.profile).toBe('grok-yolo');
    expect(grok.harnessRouting).toBeUndefined();
  });

  it('applyUnattendedScheduledLaunch overlays autonomous execution on resume profiles', () => {
    const resumed = applyUnattendedScheduledLaunch({ profile: 'claude-resume' as const, scheduled: true });
    expect(resumed.profile).toBe('claude-resume');
    expect(resumed.harnessRouting?.byAdapter.claude?.executionState).toBe('autonomous');
  });

  it('leaves interactive launches untouched', () => {
    const opts = { profile: 'claude' as const, scheduled: false as const };
    expect(applyUnattendedScheduledLaunch(opts)).toBe(opts);
  });
});
