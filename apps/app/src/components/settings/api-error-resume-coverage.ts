import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';

export interface ApiErrorResumeCoverage {
  kind: 'some' | 'none' | 'unknown';
  /** Labels of installed agents that report API errors, in descriptor order. */
  covered: string[];
  /** Labels of installed agents that cannot report API errors yet. */
  uncovered: string[];
}

/** Section intro, shared with its settings-search entry so the two never drift. */
export const API_ERROR_RESUME_HELP =
  "When an agent's turn stops on an API error that matches a rule below, Zana sends it a message so it carries on. Off by default. Covers CLI Agent tabs, Squad engineers and scheduled runs for agents that report API errors.";

export const API_ERROR_RESUME_NONE_COVERED =
  'None of the agents installed on this machine can report API errors yet. Agents on other hosts may still be covered.';

/**
 * Summarise which agents installed and enabled on this machine API-error resume covers; labels come from the descriptors.
 * Information only: sessions may run on other hosts, so the result never disables the setting.
 */
export function apiErrorResumeCoverage(descriptors: readonly HarnessAdapterDescriptor[] | null | undefined): ApiErrorResumeCoverage {
  const known = (descriptors ?? []).filter(
    (d) => d.availability.installed && d.availability.enabled && d.agentDefaultEligible && d.apiErrorResume !== undefined
  );
  const covered = known.filter((d) => d.apiErrorResume === 'supported').map((d) => d.label);
  const uncovered = known.filter((d) => d.apiErrorResume !== 'supported').map((d) => d.label);
  const kind = covered.length ? 'some' : uncovered.length ? 'none' : 'unknown';
  return { kind, covered, uncovered };
}

/** The one line under the help text, or null when coverage is unknown. */
export function apiErrorResumeCoverageLine(coverage: ApiErrorResumeCoverage): string | null {
  if (coverage.kind === 'unknown') return null;
  if (coverage.kind === 'none') return API_ERROR_RESUME_NONE_COVERED;
  const works = `On this machine, works with: ${coverage.covered.join(', ')}.`;
  return coverage.uncovered.length ? `${works} Not available yet: ${coverage.uncovered.join(', ')}.` : works;
}
