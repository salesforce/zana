import { launchDigest } from '@zana-ai/zcc-server/services/launch/digest';
import type { ExecutionPreflightDecision } from '@zana-ai/zcc-server/services/launch/preflight';

type AllowedExecution = Extract<ExecutionPreflightDecision, { decision: 'allowed' }>;

/**
 * Pre-commit check that the execution decision main re-derived just before the
 * spawn still matches the one the launch was authorized with: evidence/consent
 * binding AND the concrete model id a portable level resolved to (`modelPin`).
 * The spawn uses the authorized pin verbatim; a re-probe that now resolves the
 * level differently (gateway changed, probe failed) refuses the commit rather
 * than spawning a model other than the authorized one.
 */
export function compareCommitExecution(
  current: AllowedExecution,
  authorizedBinding: { scope?: unknown; evidenceDigest?: unknown; consentReservation?: unknown },
  authorized: Pick<AllowedExecution, 'modelPin'>
): { ok: true } | { ok: false; reason: string } {
  const currentBinding = {
    scope: current.scope,
    evidenceDigest: current.evidenceDigest,
    consentReservation: current.consentReservation
  };
  const expectedBinding = {
    scope: authorizedBinding.scope,
    evidenceDigest: authorizedBinding.evidenceDigest,
    consentReservation: authorizedBinding.consentReservation
  };
  if (launchDigest(currentBinding) !== launchDigest(expectedBinding)) {
    return { ok: false, reason: 'execution evidence or consent changed after preflight' };
  }
  if (launchDigest({ pin: current.modelPin }) !== launchDigest({ pin: authorized.modelPin })) {
    return { ok: false, reason: 'model target changed after preflight' };
  }
  return { ok: true };
}
