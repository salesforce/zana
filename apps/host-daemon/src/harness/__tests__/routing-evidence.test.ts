import { describe, expect, it } from 'vitest';
import { providerFor } from '../registry.js';
import { evaluateFacetEvidence, evaluateTargetEvidence } from '../routing-evidence.js';

describe('structured routing evidence', () => {
  it('accepts approved facet evidence at or above the reviewed floor and rejects older versions', () => {
    const provider = providerFor('opencode');
    expect(evaluateFacetEvidence(provider, 'opening-prompt', 'local', '1.18.0')).toMatchObject({
      classification: 'available', evidence: { id: 'opencode.facet.opening-prompt' }
    });
    expect(evaluateFacetEvidence(provider, 'opening-prompt', 'local', '1.18.15')).toMatchObject({
      classification: 'available', evidence: { id: 'opencode.facet.opening-prompt' }
    });
    expect(evaluateFacetEvidence(provider, 'opening-prompt', 'local', '1.2.3')).toEqual({
      classification: 'unavailable', reason: 'CLI version below reviewed floor (installed 1.2.3, requires >= 1.18.0)'
    });
    expect(evaluateFacetEvidence(provider, 'opening-prompt', 'remote', '1.18.0')).toMatchObject({
      classification: 'available', evidence: { id: 'opencode.facet.opening-prompt-remote' }
    });
  });

  it('accepts approved model targets for local and remote launches', () => {
    const provider = providerFor('opencode');
    const role = provider.adapter.descriptor.targets!.roles[0];
    const model = provider.adapter.descriptor.targets!.models[0];
    expect(evaluateTargetEvidence(provider, role, 'local', '1.2.3')).toEqual({
      classification: 'unavailable', reason: 'CLI version below reviewed floor (installed 1.2.3, requires >= 1.18.0)'
    });
    expect(evaluateTargetEvidence(provider, model, 'local', '1.18.0')).toMatchObject({
      classification: 'available', evidence: { id: model.id, scope: 'local' }
    });
    expect(evaluateTargetEvidence(provider, model, 'remote', '1.18.0')).toMatchObject({
      classification: 'available', evidence: { id: model.id, scope: 'remote' }
    });
  });

  it('selects the matching-scope evidence row when local and remote share an id', () => {
    const claude = providerFor('claude');
    const model = claude.adapter.descriptor.targets!.models[0];
    expect(evaluateTargetEvidence(claude, model, 'local', '2.1.209')).toMatchObject({
      classification: 'available', evidence: { id: model.id, scope: 'local' }
    });
    expect(evaluateTargetEvidence(claude, model, 'remote', '2.1.209')).toMatchObject({
      classification: 'available', evidence: { id: model.id, scope: 'remote' }
    });
  });
});
