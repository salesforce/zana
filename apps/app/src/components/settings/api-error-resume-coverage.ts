import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';

export interface ApiErrorResumeCoverage {
  kind: 'some' | 'none' | 'unknown';
  /** Labels of installed agents that report API errors, in descriptor order. */
  covered: string[];
  /** Labels of installed agents that cannot report API errors yet. */
  uncovered: string[];
}

/** Summarise which installed agents API-error resume covers. */
export function apiErrorResumeCoverage(_descriptors: readonly HarnessAdapterDescriptor[] | null | undefined): ApiErrorResumeCoverage {
  throw new Error('not implemented');
}
