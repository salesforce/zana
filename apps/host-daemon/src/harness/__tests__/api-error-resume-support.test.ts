import { describe, expect, it } from 'vitest';
import { apiErrorResumeSupport, harnessAdapterDescriptors, registeredAdapters } from '../registry.js';

// REQ-4: the descriptor sent to the renderer says whether a harness reports API errors.
describe('apiErrorResumeSupport', () => {
  it.each(['hook', 'sdk-events', 'screen-scan'])('is supported for the %s signal', (apiErrorSignal) => {
    expect(apiErrorResumeSupport({ status: { apiErrorSignal } })).toBe('supported');
  });

  it('is unsupported for the none signal', () => {
    expect(apiErrorResumeSupport({ status: { apiErrorSignal: 'none' } })).toBe('unsupported');
  });

  it('is unsupported when the adapter has no status', () => {
    expect(apiErrorResumeSupport({})).toBe('unsupported');
  });
});

describe('harnessAdapterDescriptors apiErrorResume', () => {
  const descriptors = harnessAdapterDescriptors(new Map());
  const byId = (id: string) => descriptors.find((entry) => entry.id === id);

  it('marks Claude supported', () => {
    expect(byId('claude')?.apiErrorResume).toBe('supported');
  });

  it.each(['codex', 'opencode', 'cursor', 'pi', 'grok', 'mastracode', 'afcode'])('marks %s unsupported', (id) => {
    expect(byId(id)?.apiErrorResume).toBe('unsupported');
  });

  it('marks the status-less shell unsupported, never leaves it absent', () => {
    expect(byId('shell')?.apiErrorResume).toBe('unsupported');
  });

  it('sets the field for every registered adapter, derived from its own status', () => {
    for (const provider of registeredAdapters()) {
      const id = provider.adapter.descriptor.id;
      const signal = provider.adapter.status?.apiErrorSignal;
      expect(byId(id)?.apiErrorResume, id).toBe(signal && signal !== 'none' ? 'supported' : 'unsupported');
    }
  });
});
