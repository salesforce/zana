import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(128);
/** A bare Git host, optionally with a port: never a URL, path or credential. */
export const gitAuthHostSchema = z.string().max(253).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[1-9][0-9]{0,4})?$/);

/** Optional browser sign-in for the marketplace host. The host is distribution data, never renderer-supplied. */
export const onboardingGitAuthSchema = z.object({
  host: gitAuthHostSchema,
  method: z.literal('gh-device')
}).strict();

/** Lowercase bare DNS domain, e.g. `example.com`: no `@`, scheme, path or port. */
const emailDomain = z.string().max(253).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/);

/** Distribution data used by main to recognise the user's workplace from the global git email. */
export const onboardingIdentityHintProfileSchema = z.object({
  emailDomains: z.array(emailDomain).min(1).max(16)
}).strict();

/** Result of the main-side identity probe. `email` is present only on a match. */
export const onboardingIdentityHintSchema = z.object({
  match: z.boolean(),
  email: z.string().max(254).optional()
}).strict();

export const onboardingStepIdSchema = z.enum(['harness', 'workplace', 'bundle', 'advanced']);
export const onboardingStepStateSchema = z.enum(['todo', 'done', 'skipped', 'background']);
export const ONBOARDING_STEP_IDS = onboardingStepIdSchema.options;

/** Distribution-owned presentation data. Selecting an audience never grants access. */
export const onboardingProfileSchema = z.object({
  id,
  organization: z.string().min(1).max(80),
  question: z.string().min(1).max(200),
  prerequisite: z.string().min(1).max(600),
  marketplaceSource: z.string().min(1).max(4096),
  gitAuth: onboardingGitAuthSchema.optional(),
  identityHint: onboardingIdentityHintProfileSchema.optional()
}).strict();

/** Read-only access probe. Never carries a token; `login` is the account name only. */
export const gitAccessStatusSchema = z.object({
  host: gitAuthHostSchema,
  reachable: z.boolean(),
  cli: z.enum(['available', 'missing']),
  signedIn: z.enum(['yes', 'no', 'unknown']),
  login: z.string().max(128).optional()
}).strict();

/** Device sign-in lifecycle. `code`/`verificationUrl` are shown to the user; nothing secret leaves main. */
export const gitSignInStateSchema = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('idle') }).strict(),
  z.object({ phase: z.literal('starting') }).strict(),
  z.object({ phase: z.literal('waiting'), code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/), verificationUrl: z.string().url().max(2048), expiresAt: z.number() }).strict(),
  z.object({ phase: z.literal('finishing') }).strict(),
  z.object({ phase: z.literal('succeeded') }).strict(),
  z.object({ phase: z.literal('expired') }).strict(),
  z.object({ phase: z.literal('failed'), error: z.string().max(500) }).strict()
]);

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

const onboardingStepsSchema = z.object({
  harness: onboardingStepStateSchema,
  workplace: onboardingStepStateSchema,
  bundle: onboardingStepStateSchema,
  advanced: onboardingStepStateSchema
}).strict();

/** v2 progress: per-step state for the non-blocking companion. `profileId` is absent without a distribution profile. */
export const onboardingProgressV2Schema = z.object({
  version: z.literal(2),
  profileId: id.optional(),
  audience: z.enum(['undecided', 'organization', 'general']),
  steps: onboardingStepsSchema,
  minimized: z.boolean().optional(),
  completedAt: z.string().datetime().optional(),
  marketplaceSource: z.string().min(1).max(4096).optional(),
  packId: id.optional(),
  pluginIds: z.array(id).max(32).optional()
}).strict();

export type OnboardingStepId = z.infer<typeof onboardingStepIdSchema>;
export type OnboardingStepState = z.infer<typeof onboardingStepStateSchema>;
export type OnboardingProgressV1 = z.infer<typeof onboardingProgressSchema>;
export type OnboardingProgressV2 = z.infer<typeof onboardingProgressV2Schema>;
export type OnboardingIdentityHint = z.infer<typeof onboardingIdentityHintSchema>;

export function emptyOnboardingSteps(): Record<OnboardingStepId, OnboardingStepState> {
  return { harness: 'todo', workplace: 'todo', bundle: 'todo', advanced: 'todo' };
}

/** True when every step is finished or deliberately skipped (`background` is still running). */
export function onboardingStepsSettled(steps: Record<OnboardingStepId, OnboardingStepState>): boolean {
  return ONBOARDING_STEP_IDS.every(step => steps[step] === 'done' || steps[step] === 'skipped');
}

/** Map v1 progress to v2. The v1 journey replaced the old tour, so its harness/advanced steps stay `todo`. */
export function migrateOnboardingProgress(v1: OnboardingProgressV1): OnboardingProgressV2 {
  const steps = emptyOnboardingSteps();
  if (v1.audience === 'general') { steps.workplace = 'skipped'; steps.bundle = 'skipped'; }
  else if (v1.audience === 'organization') {
    steps.workplace = 'done';
    if (v1.step === 'complete') steps.bundle = 'done';
  }
  const { version: _version, step: _step, ...rest } = v1;
  return { ...rest, version: 2, steps };
}

/** Parse any stored progress (v1 or v2) into v2, or `undefined` when invalid. */
export function parseOnboardingProgress(input: unknown): OnboardingProgressV2 | undefined {
  const v2 = onboardingProgressV2Schema.safeParse(input);
  if (v2.success) return v2.data;
  const v1 = onboardingProgressSchema.safeParse(input);
  return v1.success ? migrateOnboardingProgress(v1.data) : undefined;
}


export type OnboardingProfile = z.infer<typeof onboardingProfileSchema>;
/** Current progress shape (v2). v1 values are migrated on read. */
export type OnboardingProgress = OnboardingProgressV2;
export type OnboardingGitAuth = z.infer<typeof onboardingGitAuthSchema>;
export type GitAccessStatus = z.infer<typeof gitAccessStatusSchema>;
export type GitSignInState = z.infer<typeof gitSignInStateSchema>;
