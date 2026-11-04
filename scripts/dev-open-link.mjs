#!/usr/bin/env node
/**
 * `pnpm dev:open-link "<url>"` — deliver a plugin deep link to the running dev app.
 *
 *   pnpm dev:open-link "zana-dev://plugin/<pluginId>/<route>?d=<payload>"
 *
 * Launches the dev Electron build (`out-dev/main/index.js`, produced by
 * `pnpm run dev`) with the link as an argument and the same isolated data dir as
 * `pnpm run dev`. Electron's single-instance lock is per userData, so this second
 * process hands its argv to the running dev app (`second-instance`) and exits.
 * If no dev app is running it simply starts one, and the link is routed once the
 * window is ready. The app re-validates the link; this script only rejects
 * obviously wrong input early.
 *
 * macOS cannot register an unpackaged Electron as the OS handler for a scheme, so
 * clicking a `zana-dev://` link in another app does not work in dev there; this
 * helper is the dev entry point. On Windows/Linux, ZCC_REGISTER_DEV_PROTOCOL=1 in
 * the dev environment registers the scheme with the OS as well.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, prepareLocalDevEnv } from './dev-local.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LINK_SCHEMES = ['zana-dev', 'zana'];
const MAX_LINK_LENGTH = 8192;

export function validateLinkArg(link) {
  if (typeof link !== 'string' || link.length === 0) return 'usage: pnpm dev:open-link "<scheme>://plugin/<pluginId>/<route>?d=<payload>"';
  if (link.length > MAX_LINK_LENGTH) return 'link is too long';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f-\u009f]/.test(link)) return 'link contains whitespace or control characters';
  const match = /^([a-z][a-z0-9+.-]*):\/\/plugin\//i.exec(link);
  if (!match) return 'link must look like <scheme>://plugin/<pluginId>/<route>';
  if (!LINK_SCHEMES.includes(match[1].toLowerCase())) return `unknown scheme "${match[1]}" (expected ${LINK_SCHEMES.join(' or ')})`;
  return null;
}

export function buildOpenLinkLaunch(link, processEnv = process.env, electronPath = createRequire(import.meta.url)('electron')) {
  const prepared = prepareLocalDevEnv(processEnv, { target: 'dev', argv: [] });
  const env = { ...prepared.env };
  // A dev link must never reach an E2E home or a different data dir.
  delete env.ZCC_E2E_HOME;
  return {
    command: electronPath,
    args: [join(repoRoot, 'out-dev', 'main', 'index.js'), link],
    env
  };
}

function main() {
  const link = process.argv[2];
  const problem = validateLinkArg(link);
  if (problem) {
    process.stderr.write(`${problem}\n`);
    process.exit(2);
  }
  const launch = buildOpenLinkLaunch(link);
  const child = spawn(launch.command, launch.args, { env: launch.env, stdio: 'inherit', cwd: repoRoot });
  child.on('exit', (code) => process.exit(code ?? 0));
}

if (isCliEntry(process.argv[1], import.meta.url)) main();
