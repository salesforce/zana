import { describe, expect, it } from 'vitest';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import { apiErrorResumeCoverage } from './api-error-resume-coverage';

const descriptor = (label: string, apiErrorResume: 'supported' | 'unsupported', availability: { enabled: boolean; installed: boolean }) =>
  ({ id: label, label, agentDefaultEligible: true, apiErrorResume, availability: { ...availability, reason: '' } }) as unknown as HarnessAdapterDescriptor;

describe('apiErrorResumeCoverage enabled flag (#649 A3)', () => {
  it('ignores an installed harness that is turned off', () => {
    const list = [
      descriptor('Claude Code', 'supported', { enabled: false, installed: true }),
      descriptor('Codex', 'unsupported', { enabled: true, installed: true })
    ];
    expect(apiErrorResumeCoverage(list)).toEqual({ kind: 'none', covered: [], uncovered: ['Codex'] });
  });

  it('is unknown when the only installed harness is turned off', () => {
    expect(apiErrorResumeCoverage([descriptor('Claude Code', 'supported', { enabled: false, installed: true })]).kind).toBe('unknown');
  });
});
