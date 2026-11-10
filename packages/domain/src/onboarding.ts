import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(128);
/** A bare Git host, optionally with a port: never a URL, path or credential. */
export const gitAuthHostSchema = z.string().max(253).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[1-9][0-9]{0,4})?$/);

/** Optional browser sign-in for the marketplace host. The host is distribution data, never renderer-supplied. */
export const onboardingGitAuthSchema = z.object({
  host: gitAuthHostSchema,
  method: z.literal('gh-device')
}).strict();

/** Distribution-owned presentation data. Selecting an audience never grants access. */
export const onboardingProfileSchema = z.object({
  id,
  organization: z.string().min(1).max(80),
  question: z.string().min(1).max(200),
  prerequisite: z.string().min(1).max(600),
  marketplaceSource: z.string().min(1).max(4096),
  gitAuth: onboardingGitAuthSchema.optional()
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

export type OnboardingProfile = z.infer<typeof onboardingProfileSchema>;
export type OnboardingProgress = z.infer<typeof onboardingProgressSchema>;
export type OnboardingGitAuth = z.infer<typeof onboardingGitAuthSchema>;
export type GitAccessStatus = z.infer<typeof gitAccessStatusSchema>;
export type GitSignInState = z.infer<typeof gitSignInStateSchema>;
