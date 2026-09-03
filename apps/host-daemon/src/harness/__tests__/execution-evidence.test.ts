import { describe, expect, it } from 'vitest';
import { normalizeHarnessVersion } from '../harness-verify.js';
import {
  evaluateExecutionEvidence,
  executionEvidenceDigest,
  type ExecutionEvidenceFixture
} from '../execution-evidence.js';
import { executionTargetFor, validateExecutionTargetCatalogs } from '../evidence-registry.js';
import { harnessAdapterDescriptors, registeredAdapters } from '../registry.js';

const fixture = (patch: Partial<ExecutionEvidenceFixture> = {}): ExecutionEvidenceFixture => ({
  id: 'codex.execution.plan',
  version: 1,
  status: 'approved',
  cliVersion: '0.140.0',
  scopes: ['local'],
  probe: 'codex --version plus policy contract suite',
  environmentAssumptions: ['clean temporary workspace', 'network available'],
  observed: {
    filesystem: 'workspace writes denied in plan',
    commands: 'commands prompt before execution',
    network: 'native sandbox unchanged',
    approvalPrompts: 'prompt shown for command execution',
    explicitDenialsRetained: true
  },
  reviewedAt: '2026-08-03',
  adapterOwnerApproval: 'codex-adapter-owner',
  ...patch
});

describe('execution evidence', () => {
  it('normalizes exact CLI versions from common --version output', () => {
    expect(normalizeHarnessVersion('codex-cli 0.140.0\n')).toBe('0.140.0');
    expect(normalizeHarnessVersion('Claude Code v1.2.3 (build 9)')).toBe('1.2.3');
    expect(normalizeHarnessVersion('development build')).toBeUndefined();
  });

  it('keeps every execution mapping bound to one stable, internally valid target', () => {
    expect(validateExecutionTargetCatalogs(registeredAdapters())).toEqual([]);
    expect(executionTargetFor(registeredAdapters()[2], 'plan')?.id).toBe('codex.execution.plan');
  });

  it('evaluates approved evidence at or above the reviewed floor and produces a stable metadata digest', () => {
    const target = { ...executionTargetFor(registeredAdapters()[2], 'plan')!, evidenceStatus: 'approved' as const };
    expect(evaluateExecutionEvidence(target, fixture(), {
      cliVersion: '0.140.0', scope: 'local', profilePosture: 'default'
    })).toEqual({ classification: 'available', evidenceDigest: executionEvidenceDigest(target, fixture()) });
    expect(executionEvidenceDigest(target, fixture())).toBe(executionEvidenceDigest(target, fixture()));
  });

  it('accepts an installed CLI version newer than the reviewed floor', () => {
    const target = { ...executionTargetFor(registeredAdapters()[2], 'plan')!, evidenceStatus: 'approved' as const };
    expect(evaluateExecutionEvidence(target, fixture(), {
      cliVersion: '0.141.0', scope: 'local', profilePosture: 'default'
    })).toMatchObject({ classification: 'available' });
  });

  it('accepts Claude 2.1.209 at its reviewed floor', () => {
    const claude = registeredAdapters().find(({ adapter }) => adapter.descriptor.id === 'claude')!;
    const target = executionTargetFor(claude, 'plan')!;
    const evidence = fixture({ id: target.id, cliVersion: '2.1.209', scopes: ['local', 'remote'] });
    expect(evaluateExecutionEvidence(target, evidence, {
      cliVersion: '2.1.209', scope: 'local', profilePosture: 'default'
    })).toMatchObject({ classification: 'available' });
  });

  it.each([
    ['missing', undefined, {}, 'missing evidence'],
    ['candidate', fixture({ status: 'candidate' }), {}, 'candidate evidence'],
    ['revoked', fixture({ status: 'revoked' }), {}, 'revoked evidence'],
    ['scope mismatch', fixture(), { scope: 'remote' as const }, 'scope mismatch'],
    ['profile mismatch', fixture(), { profilePosture: 'unrestricted' as const }, 'profile posture mismatch']
  ])('classifies %s mappings unavailable', (_name, evidence, inputPatch, reason) => {
    const target = { ...executionTargetFor(registeredAdapters()[2], 'plan')!, evidenceStatus: 'approved' as const };
    expect(evaluateExecutionEvidence(target, evidence, {
      cliVersion: '0.140.0', scope: 'local', profilePosture: 'default', ...inputPatch
    })).toEqual({ classification: 'unavailable', reason });
  });

  it('names the installed and required versions when the CLI is below the reviewed floor', () => {
    const target = { ...executionTargetFor(registeredAdapters()[2], 'plan')!, evidenceStatus: 'approved' as const };
    expect(evaluateExecutionEvidence(target, fixture(), {
      cliVersion: '0.139.9', scope: 'local', profilePosture: 'default'
    })).toEqual({
      classification: 'unavailable',
      reason: 'CLI version below reviewed floor (installed 0.139.9, requires >= 0.140.0)'
    });
    expect(evaluateExecutionEvidence(target, fixture(), {
      scope: 'local', profilePosture: 'default'
    })).toEqual({
      classification: 'unavailable',
      reason: 'CLI version below reviewed floor (installed version could not be determined)'
    });
  });

  it('never lets an approved fixture promote candidate catalog metadata', () => {
    const target = { ...executionTargetFor(registeredAdapters()[2], 'plan')!, evidenceStatus: 'candidate' as const };
    expect(evaluateExecutionEvidence(target, fixture(), {
      cliVersion: '0.140.0', scope: 'local', profilePosture: 'default'
    })).toEqual({ classification: 'unavailable', reason: 'candidate target evidence' });
  });

  it('ships approved OpenCode execution evidence at its reviewed floor', () => {
    const target = executionTargetFor(registeredAdapters()[4], 'autonomous')!;
    expect(evaluateExecutionEvidence(target, {
      id: target.id,
      version: 1,
      status: 'approved',
      cliVersion: '1.18.0',
      scopes: ['local'],
      probe: 'opencode contract probe',
      environmentAssumptions: ['local'],
      observed: {
        filesystem: 'allowed edits auto-approve', commands: 'allowed commands auto-approve',
        network: 'allowed network tools auto-approve', approvalPrompts: 'no prompt unless denied', explicitDenialsRetained: true
      },
      reviewedAt: '2026-08-04',
      adapterOwnerApproval: 'ZCC harness execution approval'
    }, {
      cliVersion: '1.18.0', scope: 'local', profilePosture: 'default'
    })).toMatchObject({ classification: 'available', evidenceDigest: expect.any(String) });
  });

  it('fails closed for unknown target IDs', () => {
    expect(executionTargetFor(registeredAdapters()[2], 'unknown')).toBeUndefined();
  });

  it('projects execution metadata without native contributions', () => {
    const descriptors = harnessAdapterDescriptors(new Map());
    const target = descriptors.find((descriptor) => descriptor.id === 'codex')?.targets?.executionTargets?.[0];
    expect(target).toMatchObject({
      id: expect.any(String),
      equivalence: expect.any(String),
      effect: expect.any(String),
      materialDifference: expect.any(String),
      risk: expect.any(String),
      evidence: { id: expect.any(String), version: expect.any(Number) },
      scopes: expect.any(Array),
      profilePostures: expect.any(Array),
      unattendedAllowed: expect.any(Boolean),
      consent: expect.any(String)
    });
    expect(target).not.toHaveProperty('args');
    expect(target).not.toHaveProperty('env');
    expect(target).not.toHaveProperty('config');
  });

  it('keeps target scopes and execution equivalence adapter-owned', () => {
    expect(executionTargetFor(registeredAdapters()[1], 'accept-edits')).toMatchObject({
      equivalence: 'closest',
      scopes: ['local']
    });
    expect(executionTargetFor(registeredAdapters()[4], 'autonomous')).toMatchObject({
      equivalence: 'exact',
      scopes: ['local', 'remote']
    });

    const descriptors = harnessAdapterDescriptors(new Map());
    expect(descriptors.find(({ id }) => id === 'cursor')?.targets?.models.every(({ scope }) => !scope.includes('remote'))).toBe(true);
    expect(descriptors.find(({ id }) => id === 'opencode')?.targets?.models.every(({ scope }) => scope.includes('local') && scope.includes('remote'))).toBe(true);
    expect(descriptors.find(({ id }) => id === 'opencode')?.targets?.roles.every(({ scope }) => scope.includes('local') && scope.includes('remote'))).toBe(true);
  });
});
