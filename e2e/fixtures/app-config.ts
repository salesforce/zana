import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DISABLED_CLAUDE_BINARY = fileURLToPath(new URL('./isolated-cli-bin/claude', import.meta.url));

/** CLI health checks resolve bare `claude`, independently of app configuration. */
export function isolatedClaudePath(path: string | undefined, allowLiveClaude = false): string | undefined {
  if (allowLiveClaude) return path;
  return [dirname(DISABLED_CLAUDE_BINARY), path].filter(Boolean).join(delimiter);
}

/**
 * Isolated homes have no macOS login keychain, so `@salesforce/core` would ask macOS to
 * create one and open a "Keychain Not Found" dialog. The generic keychain keeps the key in
 * the isolated home's `.sfdx/key.json`. A preserved real HOME keeps its real keychain.
 */
export function isolatedKeychainEnv(preserveHome: boolean): Record<string, string> {
  return preserveHome ? {} : { SF_USE_GENERIC_UNIX_KEYCHAIN: 'true' };
}

/**
 * A preserved real HOME also drops a value inherited from the parent shell, or the real
 * home would get a new `.sfdx/key.json` that cannot decrypt its org logins. A spec's own value wins.
 */
export function dropInheritedKeychainEnv(env: Record<string, string>, preserveHome: boolean, explicit: Record<string, string> = {}): void {
  if (preserveHome && explicit.SF_USE_GENERIC_UNIX_KEYCHAIN === undefined) delete env.SF_USE_GENERIC_UNIX_KEYCHAIN;
}

/** Isolated homes have no login keychain. Never discover a real Claude by default. */
export function writeAppConfig(
  home: string,
  initialConfig: Record<string, unknown> = {},
  allowLiveClaude = false,
): void {
  const dir = join(home, '.zcc');
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, 'config.json');
  const exists = existsSync(configPath);
  // Relaunches retain settings changed by the test, including explicit fake CLIs.
  const config: Record<string, unknown> = exists
    ? JSON.parse(readFileSync(configPath, 'utf8'))
    : { walkthroughCompleted: true, setupDismissed: true, ...initialConfig };
  if (!allowLiveClaude && config.claudeBinary === undefined) {
    config.claudeBinary = DISABLED_CLAUDE_BINARY;
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  } else if (!exists) {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
}
