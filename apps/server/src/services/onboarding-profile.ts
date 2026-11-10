import { onboardingProfileSchema, type OnboardingProfile } from '@zana-ai/zcc-domain/onboarding';
import distributionProfile from '../../../../resources/onboarding-profile.json';

/** Host-owned distribution metadata, bundled into the server; no runtime file/path authority. */
export function getOnboardingProfile(env: NodeJS.ProcessEnv = process.env): OnboardingProfile | null {
  const override = env.ZCC_ONBOARDING_PROFILE?.trim();
  if (override === 'off') return null;
  if (override && override.length > 16_384) throw new Error('Setup profile is too large');
  return onboardingProfileSchema.parse(override ? JSON.parse(override) : distributionProfile);
}
