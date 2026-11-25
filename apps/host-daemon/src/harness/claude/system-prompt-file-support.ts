/**
 * Capability probe for `--append-system-prompt-file`. The flag is not listed on
 * its own line in older `claude --help` output, so it is detected from the help
 * text (`--append-system-prompt-file` or the `--append-system-prompt[-file]`
 * shorthand). A missing, slow or unreadable binary counts as "unsupported", so
 * older builds keep today's inline argv. Probed once per binary per process.
 */

import { execFileSync } from 'node:child_process';

const PROBE_TIMEOUT_MS = 3000;
const supportCache = new Map<string, boolean>();

export function helpMentionsAppendSystemPromptFile(help: string): boolean {
  return help.includes('--append-system-prompt-file') || help.includes('--append-system-prompt[-file]');
}

export function claudeSupportsAppendSystemPromptFile(
  bin: string,
  exec: (command: string, args: readonly string[]) => string = (command, args) =>
    execFileSync(command, [...args], {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    })
): boolean {
  const cached = supportCache.get(bin);
  if (cached !== undefined) return cached;
  let supported = false;
  try {
    supported = helpMentionsAppendSystemPromptFile(exec(bin, ['--help']));
  } catch {
    supported = false;
  }
  supportCache.set(bin, supported);
  return supported;
}

/** Test-only: clear cached verdicts. */
export function resetSystemPromptFileSupportCacheForTests(): void {
  supportCache.clear();
}
