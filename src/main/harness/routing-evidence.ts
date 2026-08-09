import type { HarnessEvidence, HarnessPersonaFacet, HarnessScope } from '../../shared/harness-adapter.js';
import type { LaunchProvider } from './launch-provider.js';
import { compareVersions } from '@zana-ai/zcc-extension-sdk';

export type RoutingEvidenceDecision =
  | { classification: 'available'; evidence: HarnessEvidence }
  | { classification: 'unavailable'; reason: string };

function evidenceMatches(
  evidence: HarnessEvidence | undefined,
  installedVersion: string | undefined,
  scope: HarnessScope
): RoutingEvidenceDecision {
  if (!evidence) return { classification: 'unavailable', reason: 'missing evidence' };
  if (!evidence.versionRange || !installedVersion || compareVersions(installedVersion, evidence.versionRange) < 0) {
    return {
      classification: 'unavailable',
      reason: installedVersion && evidence.versionRange
        ? `CLI version below reviewed floor (installed ${installedVersion}, requires >= ${evidence.versionRange})`
        : 'CLI version below reviewed floor (installed version could not be determined)'
    };
  }
  if (evidence.scope !== scope) return { classification: 'unavailable', reason: 'scope mismatch' };
  if (!evidence.probe || !evidence.observed || !evidence.reviewedAt) {
    return { classification: 'unavailable', reason: 'incomplete evidence' };
  }
  return { classification: 'available', evidence };
}

export function evaluateFacetEvidence(
  provider: LaunchProvider,
  facet: HarnessPersonaFacet,
  scope: HarnessScope,
  installedVersion: string | undefined
): RoutingEvidenceDecision {
  const support = provider.adapter.descriptor.capabilities[facet][scope];
  if (support.support === 'unsupported') {
    return { classification: 'unavailable', reason: `${facet} unsupported for ${scope} launches` };
  }
  return evidenceMatches(support.evidence, installedVersion, scope);
}

export function evaluateTargetEvidence(
  provider: LaunchProvider,
  target: { id: string; scope: readonly HarnessScope[]; evidenceVersion?: string },
  scope: HarnessScope,
  installedVersion: string | undefined
): RoutingEvidenceDecision {
  if (!target.scope.includes(scope)) return { classification: 'unavailable', reason: 'scope mismatch' };
  if (!target.evidenceVersion) return { classification: 'unavailable', reason: 'missing evidence version' };
  const evidence = provider.adapter.evidence.find((candidate) => candidate.id === target.id);
  const evaluated = evidenceMatches(evidence, installedVersion, scope);
  if (evaluated.classification === 'unavailable') return evaluated;
  if (evaluated.evidence.versionRange !== target.evidenceVersion) {
    return { classification: 'unavailable', reason: 'evidence version mismatch' };
  }
  return evaluated;
}
