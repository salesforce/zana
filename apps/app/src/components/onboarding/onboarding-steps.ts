import { emptyOnboardingSteps, type OnboardingProfile, type OnboardingProgress, type OnboardingStepId, type OnboardingStepState } from '@zana-ai/zcc-domain/onboarding';

const ALL: readonly OnboardingStepId[] = ['harness', 'workplace', 'bundle', 'advanced'];

/** Without a distribution profile there is no workplace step. */
export function visibleSteps(profile: OnboardingProfile | null): OnboardingStepId[] {
  return ALL.filter(id => id !== 'workplace' || !!profile);
}

export function stepStates(progress: OnboardingProgress | undefined): Record<OnboardingStepId, OnboardingStepState> {
  return progress?.steps ?? emptyOnboardingSteps();
}

export const isHandled = (state: OnboardingStepState) => state === 'done' || state === 'skipped';

export function summarizeSteps(progress: OnboardingProgress | undefined, profile: OnboardingProfile | null) {
  const ids = visibleSteps(profile);
  const steps = stepStates(progress);
  const handled = ids.filter(id => isHandled(steps[id])).length;
  return { ids, steps, handled, total: ids.length, remaining: ids.filter(id => !isHandled(steps[id])), settled: handled === ids.length };
}

export const SHORT_TITLE: Record<OnboardingStepId, string> = { harness: 'Agent', workplace: 'Workplace', bundle: 'Bundle', advanced: 'Tour' };
