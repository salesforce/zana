import type {
  HarnessExecutionTarget,
  HarnessProfilePosture,
  HarnessScope
} from '../../shared/harness-adapter.js';
import { createHash } from 'node:crypto';
import { compareVersions } from '@zana-ai/zcc-extension-sdk';

export interface ExecutionEvidenceFixture {
  id: string;
  version: number;
  status: 'candidate' | 'approved' | 'revoked';
  cliVersion: string;
  scopes: readonly HarnessScope[];
  probe: string;
  environmentAssumptions: readonly string[];
  observed: {
    filesystem: string;
    commands: string;
    network: string;
    approvalPrompts: string;
    explicitDenialsRetained: boolean;
  };
  reviewedAt: string;
  adapterOwnerApproval: string;
}

export function executionEvidenceDigest(
  target: HarnessExecutionTarget,
  evidence: ExecutionEvidenceFixture
): string {
  const payload = {
    target: {
      id: target.id,
      state: target.state,
      equivalence: target.equivalence,
      effect: target.effect,
      materialDifference: target.materialDifference,
      risk: target.risk,
      evidence: target.evidence,
      scopes: [...target.scopes].sort(),
      profilePostures: [...target.profilePostures].sort(),
      unattendedAllowed: target.unattendedAllowed,
      consent: target.consent
    },
    evidence: {
      id: evidence.id,
      version: evidence.version,
      status: evidence.status,
      cliVersion: evidence.cliVersion,
      scopes: [...evidence.scopes].sort(),
      probe: evidence.probe,
      environmentAssumptions: [...evidence.environmentAssumptions].sort(),
      observed: evidence.observed,
      reviewedAt: evidence.reviewedAt,
      adapterOwnerApproval: evidence.adapterOwnerApproval
    }
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function evaluateExecutionEvidence(
  target: HarnessExecutionTarget,
  evidence: ExecutionEvidenceFixture | undefined,
  input: { cliVersion?: string; scope: HarnessScope; profilePosture: HarnessProfilePosture }
): { classification: 'available'; evidenceDigest: string } | { classification: 'unavailable'; reason: string } {
  if (target.evidenceStatus !== 'approved') {
    return { classification: 'unavailable', reason: `${target.evidenceStatus} target evidence` };
  }
  if (!evidence) return { classification: 'unavailable', reason: 'missing evidence' };
  if (evidence.id !== target.evidence.id || evidence.version !== target.evidence.version) {
    return { classification: 'unavailable', reason: 'evidence mismatch' };
  }
  if (evidence.status !== 'approved') {
    return { classification: 'unavailable', reason: `${evidence.status} evidence` };
  }
  if (!input.cliVersion || compareVersions(input.cliVersion, evidence.cliVersion) < 0) {
    return {
      classification: 'unavailable',
      reason: input.cliVersion
        ? `CLI version below reviewed floor (installed ${input.cliVersion}, requires >= ${evidence.cliVersion})`
        : 'CLI version below reviewed floor (installed version could not be determined)'
    };
  }
  if (!target.scopes.includes(input.scope) || !evidence.scopes.includes(input.scope)) {
    return { classification: 'unavailable', reason: 'scope mismatch' };
  }
  if (!target.profilePostures.includes(input.profilePosture)) {
    return { classification: 'unavailable', reason: 'profile posture mismatch' };
  }
  return { classification: 'available', evidenceDigest: executionEvidenceDigest(target, evidence) };
}
