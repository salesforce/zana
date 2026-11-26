import { describe, expect, it } from 'vitest';
import { gitAccessStatusSchema, gitSignInStateSchema, onboardingProfileSchema, onboardingProgressSchema } from './onboarding.js';

const base = { version: 1, profileId: 'employees', audience: 'organization', step: 'marketplace' };
describe('onboarding preferences are bounded, validated data, not access grants', () => {
  it.each(['marketplace', 'bundles', 'connections', 'complete'])('accepts employee progress at %s', step => {
    expect(onboardingProgressSchema.parse({ ...base, step, marketplaceSource: 'git:https://internal.invalid/catalog', packId: 'starter', pluginIds: ['work'] }).step).toBe(step);
  });
  it.each([
    { ...base, audience: 'admin' }, { ...base, version: 2 }, { ...base, profileId: '../escape' },
    { ...base, pluginIds: ['../outside'] }, { ...base, pluginIds: Array(33).fill('work') },
    { ...base, audience: 'general' }, { ...base, audience: 'undecided' },
    { ...base, permissions: '*' }, { ...base, marketplaceSource: 'x'.repeat(4097) }
  ])('rejects invalid or inconsistent progress %j', input => {
    expect(onboardingProgressSchema.safeParse(input).success).toBe(false);
  });
  it('accepts a skipped prompt and an explicit general setup choice', () => {
    expect(onboardingProgressSchema.safeParse({ ...base, audience: 'undecided', step: 'welcome' }).success).toBe(true);
    expect(onboardingProgressSchema.safeParse({ ...base, audience: 'general', step: 'complete' }).success).toBe(true);
  });
  it('validates distribution metadata and rejects unknown/oversized fields', () => {
    const profile = { id: 'employees', organization: 'Example', question: 'Employee?', prerequisite: 'Connect first.', marketplaceSource: 'path:/fixture' };
    expect(onboardingProfileSchema.parse(profile)).toEqual(profile);
    expect(onboardingProfileSchema.safeParse({ ...profile, pluginId: 'hidden-install' }).success).toBe(false);
    expect(onboardingProfileSchema.safeParse({ ...profile, prerequisite: 'x'.repeat(601) }).success).toBe(false);
  });
  it('accepts only a bare Git host for browser sign-in', () => {
    const profile = { id: 'employees', organization: 'Example', question: 'Employee?', prerequisite: 'Connect first.', marketplaceSource: 'path:/fixture' };
    expect(onboardingProfileSchema.safeParse({ ...profile, gitAuth: { host: 'git.example.test', method: 'gh-device' } }).success).toBe(true);
    expect(onboardingProfileSchema.safeParse({ ...profile, gitAuth: { host: 'git.example.test:8443', method: 'gh-device' } }).success).toBe(true);
    for (const host of ['https://git.example.test', 'git.example.test/path', 'user@git.example.test', '-flag', 'GIT.EXAMPLE', ''])
      expect(onboardingProfileSchema.safeParse({ ...profile, gitAuth: { host, method: 'gh-device' } }).success).toBe(false);
    expect(onboardingProfileSchema.safeParse({ ...profile, gitAuth: { host: 'git.example.test', method: 'password' } }).success).toBe(false);
  });
  it('bounds access status and sign-in states, which never carry secrets', () => {
    expect(gitAccessStatusSchema.safeParse({ host: 'git.example.test', reachable: true, cli: 'available', signedIn: 'yes', login: 'ada' }).success).toBe(true);
    expect(gitAccessStatusSchema.safeParse({ host: 'git.example.test', reachable: true, cli: 'available', signedIn: 'yes', token: 'x' }).success).toBe(false);
    expect(gitSignInStateSchema.parse({ phase: 'waiting', code: 'AB12-CD34', verificationUrl: 'https://git.example.test/login/device', expiresAt: 1 }).phase).toBe('waiting');
    expect(gitSignInStateSchema.safeParse({ phase: 'waiting', code: 'bad', verificationUrl: 'https://x', expiresAt: 1 }).success).toBe(false);
    expect(gitSignInStateSchema.safeParse({ phase: 'succeeded', token: 'x' }).success).toBe(false);
  });
});

import {
  emptyOnboardingSteps, migrateOnboardingProgress, onboardingIdentityHintSchema, onboardingProgressV2Schema,
  onboardingStepsSettled, parseOnboardingProgress
} from './onboarding.js';

describe('onboarding v2 progress', () => {
  const v1 = { version: 1 as const, profileId: 'employees', audience: 'organization' as const, step: 'complete' as const, marketplaceSource: 'path:/x', packId: 'starter', pluginIds: ['work'] };
  it('migrates v1 organization, general and undecided progress', () => {
    const org = migrateOnboardingProgress(v1);
    expect(org).toMatchObject({ version: 2, profileId: 'employees', audience: 'organization', marketplaceSource: 'path:/x', packId: 'starter', pluginIds: ['work'], steps: { harness: 'todo', workplace: 'done', bundle: 'done', advanced: 'todo' } });
    expect(org).not.toHaveProperty('step');
    expect(migrateOnboardingProgress({ ...v1, step: 'marketplace' }).steps.bundle).toBe('todo');
    expect(migrateOnboardingProgress({ ...v1, audience: 'general' }).steps).toMatchObject({ workplace: 'skipped', bundle: 'skipped' });
    expect(migrateOnboardingProgress({ ...v1, audience: 'undecided', step: 'welcome' }).steps).toEqual(emptyOnboardingSteps());
    expect(onboardingProgressV2Schema.safeParse(org).success).toBe(true);
  });
  it('parses v1, v2 and rejects garbage or partial steps', () => {
    expect(parseOnboardingProgress(v1)?.version).toBe(2);
    const v2 = { version: 2, audience: 'undecided', steps: emptyOnboardingSteps(), minimized: true, completedAt: '2026-01-01T00:00:00.000Z' };
    expect(parseOnboardingProgress(v2)).toEqual(v2);
    expect(parseOnboardingProgress({ ...v2, steps: { harness: 'todo' } })).toBeUndefined();
    expect(parseOnboardingProgress({ ...v2, steps: { ...v2.steps, harness: 'nope' } })).toBeUndefined();
    expect(parseOnboardingProgress({ ...v2, completedAt: 'yesterday' })).toBeUndefined();
    expect(parseOnboardingProgress(undefined)).toBeUndefined();
  });
  it('knows when steps are settled', () => {
    expect(onboardingStepsSettled(emptyOnboardingSteps())).toBe(false);
    expect(onboardingStepsSettled({ harness: 'done', workplace: 'skipped', bundle: 'done', advanced: 'skipped' })).toBe(true);
    expect(onboardingStepsSettled({ harness: 'done', workplace: 'background', bundle: 'done', advanced: 'done' })).toBe(false);
  });
  it('validates the identity hint and profile domains strictly', () => {
    expect(onboardingIdentityHintSchema.safeParse({ match: true, email: 'a@b.co' }).success).toBe(true);
    expect(onboardingIdentityHintSchema.safeParse({ match: false, extra: 1 }).success).toBe(false);
    expect(onboardingIdentityHintSchema.safeParse({ match: true, email: 'x'.repeat(255) }).success).toBe(false);
    const profile = { id: 'e', organization: 'E', question: 'Q?', prerequisite: 'P', marketplaceSource: 'path:/f' };
    expect(onboardingProfileSchema.safeParse({ ...profile, identityHint: { emailDomains: ['example.com'] } }).success).toBe(true);
    for (const emailDomains of [[], ['Example.com'], ['@example.com'], ['example'], ['a.com/x']])
      expect(onboardingProfileSchema.safeParse({ ...profile, identityHint: { emailDomains } }).success).toBe(false);
  });
});
