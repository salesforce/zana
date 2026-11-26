import type { OnboardingIdentityHint, OnboardingProfile } from '@zana-ai/zcc-domain/onboarding';
import { spawnCaptured, type CapturedResult } from './onboarding-git-auth.js';

const GIT_TIMEOUT_MS = 3_000;
/** Longest valid address (RFC 5321); anything longer is not an email. */
const MAX_EMAIL = 254;
const EMAIL = /^[^\s@<>()\\,;:"]{1,64}@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+)$/;

export interface IdentityHintDeps {
  env?: NodeJS.ProcessEnv;
  /** Test seam: runs `git` with the given args, returning captured output. */
  run?: (args: string[], env: NodeJS.ProcessEnv) => Promise<CapturedResult>;
  tmp?: string;
}

/** Pure: the matching lowercase domain of a git email, or null. Never throws. */
export function matchEmailDomain(output: string, domains: readonly string[]): string | null {
  const email = output.split(/\r?\n/)[0]?.trim() ?? '';
  if (!email || email.length > MAX_EMAIL) return null;
  const match = EMAIL.exec(email);
  if (!match) return null;
  return domains.includes(match[1]!.toLowerCase()) ? email : null;
}

/**
 * Reads the global git email in main (bounded: no shell, timeout, capped output captured to a 0600 temp file)
 * and compares its domain with the distribution profile. The email is returned only on a match and is never logged;
 * the renderer supplies neither the email nor the domains.
 */
export async function resolveIdentityHint(profile: OnboardingProfile | null, deps: IdentityHintDeps = {}): Promise<OnboardingIdentityHint> {
  const domains = profile?.identityHint?.emailDomains;
  if (!domains?.length) return { match: false };
  const env = { ...(deps.env ?? process.env), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
  const args = ['config', '--global', '--get', 'user.email'];
  let result: CapturedResult;
  try {
    result = await (deps.run
      ? deps.run(args, env)
      : spawnCaptured('git', args, { env, timeoutMs: GIT_TIMEOUT_MS, tmp: deps.tmp }).done);
  } catch {
    return { match: false };
  }
  if (result.error || result.code !== 0) return { match: false };
  const email = matchEmailDomain(result.output, domains);
  return email ? { match: true, email } : { match: false };
}
