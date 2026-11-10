import { create } from 'zustand';
import { onboardingProfileSchema, type OnboardingProfile, type OnboardingProgress } from '@zana-ai/zcc-domain/onboarding';
import { product } from '../../lib/product-client.js';
import { apiJson } from '../../lib/fetch-with-app-surface.js';

export const useOnboarding = create<{
  loaded: boolean;
  open: boolean;
  profile: OnboardingProfile | null;
  progress: OnboardingProgress | undefined;
  error: string | null;
}>(() => ({ loaded: false, open: false, profile: null, progress: undefined, error: null }));

export function openOnboarding() {
  useOnboarding.setState({ open: true });
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
      // Existing installations receive this once when they upgrade to a build with onboarding.
      open: !!profile && (!progress || progress.profileId !== profile.id)
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
