import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OnboardingProfile } from '@zana-ai/zcc-domain/onboarding';
import { matchEmailDomain, resolveIdentityHint } from './onboarding-identity-hint.js';

const profile: OnboardingProfile = {
  id: 'e', organization: 'Example', question: 'Q?', prerequisite: 'P', marketplaceSource: 'path:/f',
  identityHint: { emailDomains: ['example.com'] }
};
const ok = (output: string) => ({ run: async () => ({ code: 0, output }) });

describe('resolveIdentityHint', () => {
  it('returns the email only on a domain match (case-insensitive)', async () => {
    expect(await resolveIdentityHint(profile, ok('Ada@Example.COM\n'))).toEqual({ match: true, email: 'Ada@Example.COM' });
  });
  it('is no-match without a profile or hint and never runs git', async () => {
    const run = async () => { throw new Error('should not run'); };
    expect(await resolveIdentityHint(null, { run })).toEqual({ match: false });
    expect(await resolveIdentityHint({ ...profile, identityHint: undefined }, { run })).toEqual({ match: false });
  });
  it('does not match another domain or a lookalike subdomain, and omits the email', async () => {
    expect(await resolveIdentityHint(profile, ok('a@other.org\n'))).toEqual({ match: false });
    expect(await resolveIdentityHint(profile, ok('a@evil.example.com.attacker.io\n'))).toEqual({ match: false });
    expect(await resolveIdentityHint(profile, ok('a@mail.example.com\n'))).toEqual({ match: false });
  });
  it.each([['empty', ''], ['no at', 'nobody'], ['spaces', 'a b@example.com'], ['two ats', 'a@b@example.com'], ['too long', `${'a'.repeat(250)}@example.com`], ['control', '<a>@example.com']])('treats malformed output (%s) as no match', async (_n, output) => {
    expect(await resolveIdentityHint(profile, ok(output))).toEqual({ match: false });
  });
  it('treats a non-zero exit (unset), missing git and timeout as no match', async () => {
    expect(await resolveIdentityHint(profile, { run: async () => ({ code: 1, output: '' }) })).toEqual({ match: false });
    expect(await resolveIdentityHint(profile, { run: async () => ({ code: null, output: '', error: Object.assign(new Error('x'), { code: 'ENOENT' }) }) })).toEqual({ match: false });
    expect(await resolveIdentityHint(profile, { run: async () => ({ code: null, output: 'a@example.com', error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }) })).toEqual({ match: false });
    expect(await resolveIdentityHint(profile, { run: async () => { throw new Error('boom'); } })).toEqual({ match: false });
  });
  it('runs real git without a shell and reads the global config', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-idhint-'));
    const cfg = join(dir, 'gitconfig');
    writeFileSync(cfg, '[user]\n\temail = real@example.com\n');
    expect(await resolveIdentityHint(profile, { env: { ...process.env, GIT_CONFIG_GLOBAL: cfg }, tmp: dir })).toEqual({ match: true, email: 'real@example.com' });
    writeFileSync(cfg, '');
    expect(await resolveIdentityHint(profile, { env: { ...process.env, GIT_CONFIG_GLOBAL: cfg }, tmp: dir })).toEqual({ match: false });
  });
  it('reports no match when git is not on PATH', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-idhint-'));
    chmodSync(dir, 0o700);
    expect(await resolveIdentityHint(profile, { env: { PATH: dir }, tmp: dir })).toEqual({ match: false });
  });
  it('matchEmailDomain handles empty output', () => {
    expect(matchEmailDomain('', ['example.com'])).toBeNull();
  });
});
