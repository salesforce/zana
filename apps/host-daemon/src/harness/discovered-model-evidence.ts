import type { HarnessEvidence, HarnessModelTarget, HarnessScope } from '@zana-ai/zcc-domain/harness-adapter';

/**
 * Live catalog overlays replace the static model list. Preflight requires both
 * an `evidenceVersion` stamp on the target and a matching adapter.evidence row.
 */
export function overlayDiscoveredModels(
  models: readonly HarnessModelTarget[],
  existingEvidence: readonly HarnessEvidence[],
  evidenceVersion: string,
  makeEvidence: (id: string, scope: HarnessScope) => HarnessEvidence
): { models: HarnessModelTarget[]; evidence: HarnessEvidence[] } {
  const stamped = models.map((model) => ({
    ...model,
    evidenceVersion: model.evidenceVersion ?? evidenceVersion
  }));
  const known = new Set(existingEvidence.map((row) => `${row.id}:${row.scope}`));
  const extra = stamped.flatMap((model) =>
    model.scope
      .filter((scope) => !known.has(`${model.id}:${scope}`))
      .map((scope) => makeEvidence(model.id, scope))
  );
  return { models: stamped, evidence: [...existingEvidence, ...extra] };
}
