import { describe, expect, it, vi } from 'vitest';
import type { HarnessExecutionTarget } from '../../shared/harness-adapter.js';
import type { ExecutionConsentBinding, ExecutionConsentReserveResult, ExecutionConsentScope } from '../harness/execution-consent-store.js';
import { preflightExecutionAuthorization } from '../launch/preflight.js';

const target = (patch: Partial<HarnessExecutionTarget> = {}): HarnessExecutionTarget => ({
  id: 'opencode.execution.accept-edits', state: 'accept-edits', equivalence: 'closest',
  effect: 'build plus auto-approve', materialDifference: 'broader approvals', risk: 'high',
  evidence: { id: 'opencode.execution.accept-edits', version: 1 }, evidenceStatus: 'approved',
  scopes: ['local'], profilePostures: ['default'], unattendedAllowed: false, consent: 'required',
  ...patch
});

const evidence = (patch = {}) => ({
  id: 'opencode.execution.accept-edits', version: 1, status: 'approved' as const,
  cliVersion: '1.2.3', scopes: ['local'] as const,
  probe: 'opencode --version plus policy contract suite',
  environmentAssumptions: ['clean temporary workspace'],
  observed: {
    filesystem: 'edits approved', commands: 'commands auto-approved', network: 'unchanged',
    approvalPrompts: 'no prompt for edits or commands', explicitDenialsRetained: true
  },
  reviewedAt: '2026-08-03', adapterOwnerApproval: 'opencode-adapter-owner',
  ...patch
});

const consent = (
  reserve: (input: ExecutionConsentBinding & { scope: ExecutionConsentScope; idempotencyKey: string }) => Promise<ExecutionConsentReserveResult>
    = vi.fn(async () => ({ outcome: 'denied' as const }))
) => ({ reserve });

describe('execution launch preflight', () => {
  const base = {
    adapterId: 'opencode', provenance: 'portable-mapped' as const, target: target(), evidence: evidence(),
    installedVersion: '1.2.3', scope: 'local' as const, profilePosture: 'default' as const,
    projectId: 'p1', mode: 'interactive' as const, consentScopes: ['one-launch', 'project'] as const,
    idempotencyKey: 'launch-1'
  };

  it('blocks OpenCode closest translation until matching consent is reserved', async () => {
    await expect(preflightExecutionAuthorization(base, consent())).resolves.toMatchObject({
      decision: 'blocked', reason: 'no matching consent'
    });
  });

  it('validates an explicit native target without translation consent', async () => {
    const reserve = vi.fn();
    await expect(preflightExecutionAuthorization({ ...base, provenance: 'explicit-native' }, consent(reserve))).resolves.toMatchObject({ decision: 'allowed', scope: 'local' });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('validates a pinned native policy target without translation consent', async () => {
    const reserve = vi.fn();
    await expect(preflightExecutionAuthorization({
      ...base,
      adapterId: 'codex',
      provenance: 'explicit-native',
      target: target({ id: 'codex.execution.interactive', state: 'interactive', equivalence: 'exact', consent: 'none', unattendedAllowed: true, evidence: { id: 'codex.execution.interactive', version: 1 } }),
      evidence: { ...evidence(), id: 'codex.execution.interactive' }
    }, consent(reserve))).resolves.toMatchObject({ decision: 'allowed' });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('blocks candidate evidence before consent lookup', async () => {
    const reserve = vi.fn();
    await expect(preflightExecutionAuthorization({ ...base, evidence: evidence({ status: 'candidate' }) }, consent(reserve))).resolves.toEqual({
      decision: 'blocked', reason: 'candidate evidence'
    });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('allows an approved exact portable mapping without consent', async () => {
    const reserve = vi.fn();
    await expect(preflightExecutionAuthorization({ ...base, target: target({ equivalence: 'exact', consent: 'none', unattendedAllowed: true }) }, consent(reserve))).resolves.toMatchObject({ decision: 'allowed' });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('reserves a valid grant for approved closest mapping', async () => {
    const reserve = vi.fn(async () => ({
      outcome: 'reserved' as const,
       reservation: { id: 'reservation-1', grantId: 'grant-1', idempotencyKey: 'launch-1:one-launch', createdAt: 1, expiresAt: 2 },
       grant: { id: 'grant-1', adapterId: base.adapterId, targetId: base.target.id, targetDigest: 'ignored', evidenceDigest: 'ignored', projectId: 'p1', launchScope: 'local' as const, scope: 'one-launch' as const, createdAt: 1 }
    }));
    await expect(preflightExecutionAuthorization(base, consent(reserve))).resolves.toMatchObject({
      decision: 'allowed', consentReservation: { id: 'reservation-1' }
    });
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({
       adapterId: 'opencode', targetId: base.target.id, projectId: 'p1', idempotencyKey: 'launch-1:one-launch'
     }));
   });

  it('runs trusted interactive ceremony only after existing consent lookup fails', async () => {
    let attempts = 0;
    const reserve = vi.fn(async () => {
      attempts += 1;
      if (attempts <= 2) return { outcome: 'denied' as const };
      return {
        outcome: 'reserved' as const,
        reservation: { id: 'reservation-1', grantId: 'grant-1', idempotencyKey: 'launch-1:project', createdAt: 1, expiresAt: 2 },
        grant: { id: 'grant-1', adapterId: base.adapterId, targetId: base.target.id, targetDigest: 'td', evidenceDigest: 'ed', projectId: 'p1', launchScope: 'local' as const, scope: 'project' as const, createdAt: 1 }
      };
    });
    const request = vi.fn(async () => ({ decision: 'granted' as const, grant: { scope: 'project' as const } }));
    await expect(preflightExecutionAuthorization(base, { reserve, request })).resolves.toMatchObject({
      decision: 'allowed', consentReservation: { id: 'reservation-1' }
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ mode: 'interactive', adapterId: 'opencode' }));
  });

  it('never runs ceremony for headless or unattended launches', async () => {
    const reserve = vi.fn(async () => ({ outcome: 'denied' as const }));
    const request = vi.fn();
    for (const mode of ['headless', 'unattended'] as const) {
      const allowedTarget = target({ unattendedAllowed: true });
      await expect(preflightExecutionAuthorization({
        ...base, mode, target: allowedTarget, consentScopes: ['project']
      }, { reserve, request })).resolves.toEqual({ decision: 'blocked', reason: 'no matching consent' });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('blocks unattended use whenever target disallows it and never reserves consent', async () => {
    const reserve = vi.fn();
    await expect(preflightExecutionAuthorization({ ...base, mode: 'unattended' }, consent(reserve))).resolves.toEqual({
      decision: 'blocked', reason: 'target disallows unattended execution'
    });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('passes inherited native defaults without portable claims or consent', async () => {
    const reserve = vi.fn();
    await expect(preflightExecutionAuthorization({
      ...base, provenance: 'inherited-native-default', target: undefined, evidence: undefined
    }, consent(reserve))).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(reserve).not.toHaveBeenCalled();
  });
});
