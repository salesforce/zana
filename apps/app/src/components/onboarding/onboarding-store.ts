import { create } from 'zustand';
import {
  emptyOnboardingSteps, onboardingIdentityHintSchema, onboardingProfileSchema, onboardingStepsSettled,
  type OnboardingIdentityHint, type OnboardingProfile, type OnboardingProgress, type OnboardingStepId, type OnboardingStepState
} from '@zana-ai/zcc-domain/onboarding';
import { product } from '../../lib/product-client.js';
import { apiJson } from '../../lib/fetch-with-app-surface.js';

export const useOnboarding = create<{
  loaded: boolean;
  open: boolean;
  profile: OnboardingProfile | null;
  progress: OnboardingProgress | undefined;
  /** Main-side workplace probe; `undefined` until `loadIdentityHint()` resolves. */
  identityHint: OnboardingIdentityHint | undefined;
  error: string | null;
}>(() => ({ loaded: false, open: false, profile: null, progress: undefined, identityHint: undefined, error: null }));

/** Setup is offered until it is complete, with or without a distribution profile. */
export const isOnboardingPending = (progress: OnboardingProgress | undefined) => !progress || !progress.completedAt;

export function openOnboarding() {
  useOnboarding.setState({ open: true });
  // Reopening from Settings or the resume pill restores the panel.
  if (useOnboarding.getState().progress?.minimized) void setMinimized(false).catch(() => undefined);
}

function currentProgress(): OnboardingProgress {
  const { progress, profile } = useOnboarding.getState();
  return progress ?? {
    version: 2, audience: 'undecided', steps: emptyOnboardingSteps(), ...(profile ? { profileId: profile.id } : {})
  };
}

/** Mounted once in the primary desktop shell; teardown fences late reads. */
export function loadOnboarding() {
  let cancelled = false;
  // Subscribe before reading so a second window cannot be overwritten by an old snapshot.
  let changed = false;
  const off = product.config.onChanged(config => {
    if (cancelled) return;
    changed = true;
    useOnboarding.setState({ progress: config.onboarding });
  });
  const ready = Promise.all([
    apiJson<{ profile: OnboardingProfile | null }>('/onboarding/profile'),
    product.config.get()
  ]).then(([result, config]) => {
    if (cancelled) return;
    const profile = result.profile === null ? null : onboardingProfileSchema.parse(result.profile);
    const progress = changed ? useOnboarding.getState().progress : config.onboarding;
    useOnboarding.setState({
      loaded: true, profile, progress, error: null,
      // Open until complete (also without a profile). A newly configured profile re-offers setup once.
      open: isOnboardingPending(progress) || (!!profile && !!progress && progress.profileId !== profile.id)
    });
  }).catch(() => {
    if (!cancelled) useOnboarding.setState({ loaded: true, error: 'Could not load setup. Try again from Settings.' });
  });
  return { ready, dispose: () => { cancelled = true; off(); } };
}

export async function saveOnboarding(progress: OnboardingProgress) {
  // The new journey replaces the automatic tour/doctor prompts; both remain available on demand.
  const config = await product.config.set({ onboarding: progress, walkthroughCompleted: true, setupDismissed: true });
  useOnboarding.setState({ progress: config.onboarding });
}

/** Record one step's state; completes setup (`completedAt`) when every step is done or skipped. */
export async function setStep(id: OnboardingStepId, state: OnboardingStepState) {
  const base = currentProgress();
  const steps = { ...base.steps, [id]: state };
  const { completedAt: _previous, ...rest } = base;
  await saveOnboarding({ ...rest, steps, ...(onboardingStepsSettled(steps) ? { completedAt: new Date().toISOString() } : {}) });
}

export async function setMinimized(minimized: boolean) {
  await saveOnboarding({ ...currentProgress(), minimized });
}

/** Asks main whether the global git identity matches the profile. Any failure reads as "no match". */
export async function loadIdentityHint(): Promise<OnboardingIdentityHint> {
  let hint: OnboardingIdentityHint = { match: false };
  if (useOnboarding.getState().profile) {
    try {
      const parsed = onboardingIdentityHintSchema.safeParse((await apiJson<{ hint: unknown }>('/onboarding/identity-hint')).hint);
      if (parsed.success) hint = parsed.data;
    } catch { /* advisory only */ }
  }
  useOnboarding.setState({ identityHint: hint });
  return hint;
}
