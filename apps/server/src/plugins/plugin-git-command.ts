import { getOnboardingProfile } from '../services/onboarding-profile.js';
import { resolveGhBinary } from '../services/onboarding-git-auth.js';
import { runPluginSourceCommand } from './plugin-source-command.js';

type CommandOptions = NonNullable<Parameters<typeof runPluginSourceCommand>[3]>;

const AUTH_FAILURE = /authentication failed|could not read (?:username|password)|terminal prompts disabled|repository[^\r\n]*not found|access denied|not authorized|unauthorized|requested URL returned error: (?:401|403)/i;

/** Exact public messages, safe to project across the marketplace HTTP seam. */
export const PLUGIN_GIT_FAILURE_MESSAGES = {
  auth: 'Git authentication failed or the repository is unavailable. Check your Git sign-in, repository URL and access.',
  network: 'Could not connect to the Git server. Check your network or VPN.',
  certificate: 'Git certificate verification failed. Check your network certificate setup.'
} as const;

/** Classify Git diagnostics without exposing remote output, URLs or credentials. */
export function pluginGitFailure(stderr: string, fallback: string): string {
  if (AUTH_FAILURE.test(stderr)) return PLUGIN_GIT_FAILURE_MESSAGES.auth;
  if (/could not resolve|couldn't resolve|failed to connect|connection (?:refused|reset)|network is unreachable/i.test(stderr)) {
    return PLUGIN_GIT_FAILURE_MESSAGES.network;
  }
  if (/certificate|ssl[^\r\n]*error/i.test(stderr)) return PLUGIN_GIT_FAILURE_MESSAGES.certificate;
  return fallback;
}

/**
 * Existing Git credentials win. After an HTTPS auth failure, retry once with
 * gh's active login for the distribution-configured host only. The helper is
 * command-local: no token is read by Zana and no persistent Git config changes.
 * Background discovery must never invoke gh or its credential-store UI.
 */
export async function runPluginGitCommand(
  args: string[], cwd: string, url: string,
  options: CommandOptions & { nonInteractive?: boolean } = {}
): ReturnType<typeof runPluginSourceCommand> {
  const commandOptions = { ...options, env: { ...options.env, LC_ALL: 'C' } };
  const first = await runPluginSourceCommand('git', args, cwd, commandOptions);
  if (first.code === 0 || options.nonInteractive || !AUTH_FAILURE.test(first.stderr)) return first;
  let remote: URL;
  try { remote = new URL(url); } catch { return first; }
  if (remote.protocol !== 'https:' || remote.username || remote.password) return first;
  // Only host-owned distribution metadata can authorize this fallback. Invalid
  // optional setup metadata must not break ordinary plugin Git operations.
  let host: string | undefined;
  try { host = getOnboardingProfile()?.gitAuth?.host; } catch { return first; }
  if (remote.host !== host) return first;
  const gh = resolveGhBinary();
  if (!gh) return first;
  // Git runs ! helpers through its shell on every platform, including Windows.
  const helper = `!'${gh.replace(/'/g, `'\\''`)}' auth git-credential`;
  return runPluginSourceCommand('git', [
    '-c', `credential.https://${host}.helper=`,
    '-c', `credential.https://${host}.helper=${helper}`,
    '-c', 'http.followRedirects=false',
    ...args
  ], cwd, commandOptions);
}
