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
