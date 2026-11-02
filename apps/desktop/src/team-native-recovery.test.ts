import { describe, expect, it } from 'vitest';
import { modernRecoverySnapshot, compatibleNativeRecoverySnapshots, exactNativeRecoveryAvailability, nativeRecoveryLaunchSlot, nativeRecoveryProjection } from './team-native-recovery.js';

describe('nativeRecoveryProjection', () => {
  const recovery = { mode: 'exact-native' as const, slots: [{
    slotId: 'orchestrator:lead', role: 'orchestrator' as const, personaId: 'lead', profileId: 'codex', nativeConversationId: 'native-1'
  }] };

  it('recomputes matching provider-native resume fields', () => {
    expect(nativeRecoveryProjection({ recovery, slotId: 'orchestrator:lead', role: 'orchestrator', personaId: 'lead', profile: 'codex' }))
      .toEqual({ profile: 'codex-resume', resumeSessionId: 'native-1' });
  });

  it('never projects a MODERN snapshot as a CLI resume (and excludes it from CLI availability)', () => {
    const modern = { slotId: 'worker:claude', role: 'worker' as const, personaId: 'claude', profileId: 'claude', nativeConversationId: 'prov', transport: 'MODERN' as const };
    const slot = { slotId: 'worker:claude', role: 'worker' as const, personaId: 'claude', profile: 'claude' as const };
    expect(nativeRecoveryProjection({ recovery: { mode: 'exact-native', slots: [modern] }, ...slot })).toBeUndefined();
    expect(exactNativeRecoveryAvailability({ snapshots: [modern], slots: [slot] })).toEqual({ available: false, restorableSlots: 0 });
    expect(compatibleNativeRecoverySnapshots({ snapshots: [{ ...modern, transport: 'CLI' as const }], slots: [slot] })).toHaveLength(1);
  });

  it('keeps Claude on its same auth profile while projecting native resume args', () => {
    expect(nativeRecoveryProjection({
      recovery: { mode: 'exact-native', slots: [{
        slotId: 'worker:claude', role: 'worker', personaId: 'claude', profileId: 'claude', nativeConversationId: 'claude-native'
      }] },
      slotId: 'worker:claude', role: 'worker', personaId: 'claude', profile: 'claude'
    })).toEqual({ profile: 'claude', extraArgs: ['--resume', 'claude-native'] });
  });

  it('projects only native slots while fresh workers retain their configured profile', () => {
    const mixed = { mode: 'exact-native' as const, slots: [{
      slotId: 'worker:codex', role: 'worker' as const, personaId: 'codex', profileId: 'codex', nativeConversationId: 'codex-native'
    }] };
    expect(nativeRecoveryProjection({ recovery: mixed, slotId: 'worker:codex', role: 'worker', personaId: 'codex', profile: 'codex' }))
      .toEqual({ profile: 'codex-resume', resumeSessionId: 'codex-native' });
    expect(nativeRecoveryProjection({ recovery: mixed, slotId: 'worker:fresh', role: 'worker', personaId: 'fresh', profile: 'claude' }))
      .toBeUndefined();
  });

  it('uses one trusted slot projection for authorization profile and terminal spawn', () => {
    const codex = nativeRecoveryLaunchSlot({
      recovery: { mode: 'exact-native', slots: [{
        slotId: 'worker:codex', role: 'worker', personaId: 'codex', profileId: 'codex', nativeConversationId: 'codex-native'
      }] },
      slotId: 'worker:codex', role: 'worker', personaId: 'codex', profile: 'codex'
    });
    const fresh = nativeRecoveryLaunchSlot({
      recovery: { mode: 'exact-native', slots: [] },
      slotId: 'worker:fresh', role: 'worker', personaId: 'fresh', profile: 'claude'
    });
    expect(codex).toEqual({ configuredProfile: 'codex', profile: 'codex-resume', resumeSessionId: 'codex-native', recoveryResume: true });
    expect(fresh).toEqual({ configuredProfile: 'claude', profile: 'claude', recoveryResume: false });
  });

  it.each([
    ['codex', 'codex-resume', 'codex-first', 'codex-second'],
    ['opencode', 'opencode-resume', 'opencode-first', 'opencode-second']
  ] as const)('keeps configured %s identity through two exact-native recoveries', (profile, resumeProfile, firstNativeId, secondNativeId) => {
    const first = nativeRecoveryLaunchSlot({
      recovery: { mode: 'exact-native', slots: [{
        slotId: 'worker:builder', role: 'worker', personaId: 'builder', profileId: profile, nativeConversationId: firstNativeId
      }] },
      slotId: 'worker:builder', role: 'worker', personaId: 'builder', profile
    });
    expect(first).toEqual({ configuredProfile: profile, profile: resumeProfile, resumeSessionId: firstNativeId, recoveryResume: true });

    const second = nativeRecoveryLaunchSlot({
      recovery: { mode: 'exact-native', slots: [{
        slotId: 'worker:builder', role: 'worker', personaId: 'builder', profileId: first.configuredProfile, nativeConversationId: secondNativeId
      }] },
      slotId: 'worker:builder', role: 'worker', personaId: 'builder', profile
    });
    expect(second).toEqual({ configuredProfile: profile, profile: resumeProfile, resumeSessionId: secondNativeId, recoveryResume: true });
  });

  it('refuses snapshots for changed slot identity', () => {
    expect(nativeRecoveryProjection({ recovery, slotId: 'orchestrator:lead', role: 'orchestrator', personaId: 'other', profile: 'codex' })).toBeUndefined();
    expect(nativeRecoveryProjection({ recovery, slotId: 'orchestrator:lead', role: 'orchestrator', personaId: 'lead', profile: 'claude' })).toBeUndefined();
  });

  it('counts only snapshots current slots can resume', () => {
    expect(exactNativeRecoveryAvailability({
      snapshots: recovery.slots,
      slots: [{ slotId: 'orchestrator:lead', role: 'orchestrator', personaId: 'lead', profile: 'codex' }]
    })).toEqual({ available: true, restorableSlots: 1 });
    expect(exactNativeRecoveryAvailability({
      snapshots: recovery.slots,
      slots: [{ slotId: 'orchestrator:lead', role: 'orchestrator', personaId: 'lead', profile: 'shell' }]
    })).toEqual({ available: false, restorableSlots: 0 });
  });

  it('returns only current-slot and provider-compatible snapshots for service recovery', () => {
    const snapshots = [{
      version: 1 as const, attempt: 1, slotId: 'worker:builder', role: 'worker' as const, personaId: 'former-builder', profileId: 'codex', nativeConversationId: 'former-native', capturedAt: 1
    }, {
      version: 1 as const, attempt: 1, slotId: 'worker:builder', role: 'worker' as const, personaId: 'builder', profileId: 'claude', nativeConversationId: 'wrong-provider', capturedAt: 1
    }, {
      version: 1 as const, attempt: 1, slotId: 'worker:builder', role: 'worker' as const, personaId: 'builder', profileId: 'codex', nativeConversationId: 'current-native', capturedAt: 1
    }];
    expect(compatibleNativeRecoverySnapshots({
      snapshots,
      slots: [{ slotId: 'worker:builder', role: 'worker', personaId: 'builder', profile: 'codex' }]
    })).toEqual([snapshots[2]]);
  });
});

describe('nativeRecovery fallbacks', () => {
  it('returns no projection without exact-native recovery and an unmodified launch slot', () => {
    expect(nativeRecoveryProjection({ slotId: 's', role: 'worker', personaId: 'p', profile: 'claude' })).toBeUndefined();
    expect(nativeRecoveryLaunchSlot({ slotId: 's', role: 'worker', personaId: 'p', profile: 'claude' }))
      .toEqual({ configuredProfile: 'claude', profile: 'claude', recoveryResume: false });
  });

  it('emits extraArgs without a resumeSessionId for a claude resume slot', () => {
    expect(nativeRecoveryLaunchSlot({
      recovery: { mode: 'exact-native', slots: [{ slotId: 'w', role: 'worker', personaId: 'p', profileId: 'claude', nativeConversationId: 'n1' }] },
      slotId: 'w', role: 'worker', personaId: 'p', profile: 'claude'
    })).toEqual({ configuredProfile: 'claude', profile: 'claude', extraArgs: ['--resume', 'n1'], recoveryResume: true });
  });
});

describe('Modern identity fence', () => {
  const slot = { slotId: 'worker:claude', role: 'worker' as const, personaId: 'claude', profile: 'claude' as const };
  const expected = { providerId: 'acp', hostId: 'host-1', environmentPath: '/wt/a' };
  const snap = {
    slotId: 'worker:claude', role: 'worker' as const, personaId: 'claude', profileId: 'claude', nativeConversationId: 'prov-1',
    transport: 'MODERN' as const, threadId: 'thread-1', generation: 2, providerThreadId: 'prov-1',
    providerId: 'acp', hostId: 'host-1', environmentPath: '/wt/a'
  };
  const fence = (snapshot: object, extra: object = {}) => modernRecoverySnapshot({
    snapshots: [snapshot as typeof snap], ...slot, teamTransport: 'MODERN', expected, ...extra
  });

  it('accepts an exactly matching snapshot on a Modern team', () => {
    expect(fence(snap)).toBe(snap);
    expect(exactNativeRecoveryAvailability({ snapshots: [snap], teamTransport: 'MODERN', slots: [{ ...slot, modern: expected }] }))
      .toEqual({ available: true, restorableSlots: 1 });
  });

  it('accepts when host is not pre-resolved (enforced at launch)', () => {
    expect(fence(snap, { expected: { providerId: 'acp', environmentPath: '/wt/a' } })).toBe(snap);
  });

  it.each([
    ['slot', { slotId: 'worker:other' }], ['role', { role: 'orchestrator' }], ['persona', { personaId: 'x' }],
    ['profile', { profileId: 'codex' }], ['provider', { providerId: 'other' }], ['host', { hostId: 'host-2' }],
    ['worktree', { environmentPath: '/wt/b' }], ['missing thread', { threadId: undefined }],
    ['generation 0', { generation: 0 }], ['fractional generation', { generation: 1.5 }],
    ['missing provider thread', { providerThreadId: undefined }], ['native id mismatch', { nativeConversationId: 'zzz' }],
    ['missing host', { hostId: undefined }], ['CLI snapshot', { transport: 'CLI' }]
  ])('rejects drift in %s', (_name, patch) => {
    expect(fence({ ...snap, ...patch })).toBeUndefined();
  });

  it('is never usable without a Modern team or expectation', () => {
    expect(fence(snap, { teamTransport: 'CLI' })).toBeUndefined();
    expect(fence(snap, { teamTransport: undefined })).toBeUndefined();
    expect(fence(snap, { expected: undefined })).toBeUndefined();
  });

  it('keeps CLI and Modern transports apart in availability', () => {
    const cli = { slotId: 'worker:claude', role: 'worker' as const, personaId: 'claude', profileId: 'claude', nativeConversationId: 'n' };
    expect(exactNativeRecoveryAvailability({ snapshots: [cli], teamTransport: 'MODERN', slots: [{ ...slot, modern: expected }] }).available).toBe(false);
    expect(exactNativeRecoveryAvailability({ snapshots: [snap], teamTransport: 'CLI', slots: [{ ...slot, modern: expected }] }).available).toBe(false);
    expect(exactNativeRecoveryAvailability({ snapshots: [snap], teamTransport: 'MODERN', slots: [slot] }).available).toBe(false);
    expect(exactNativeRecoveryAvailability({ snapshots: [cli], teamTransport: 'CLI', slots: [slot] }).available).toBe(true);
  });
});
