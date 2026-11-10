import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(128);

/** Distribution-owned presentation data. Selecting an audience never grants access. */
export const onboardingProfileSchema = z.object({
  id,
  organization: z.string().min(1).max(80),
  question: z.string().min(1).max(200),
  prerequisite: z.string().min(1).max(600),
  marketplaceSource: z.string().min(1).max(4096)
}).strict();

/** Preferences/progress only; marketplace and plugin authority stay with their owners. */
export const onboardingProgressSchema = z.object({
  version: z.literal(1),
  profileId: id,
  audience: z.enum(['undecided', 'organization', 'general']),
  step: z.enum(['welcome', 'marketplace', 'bundles', 'connections', 'complete']),
  marketplaceSource: z.string().min(1).max(4096).optional(),
  packId: id.optional(),
  pluginIds: z.array(id).max(32).optional()
}).strict().refine(value => value.audience === 'organization'
  || (value.audience === 'general' ? value.step === 'complete' : value.step === 'welcome'),
  'progress must match the selected audience');

export type OnboardingProfile = z.infer<typeof onboardingProfileSchema>;
export type OnboardingProgress = z.infer<typeof onboardingProgressSchema>;
