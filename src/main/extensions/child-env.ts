/**
 * Env-var allowlist for UNTRUSTED extension children (isolation finding A / 0.4).
 *
 * This is the single source of truth for "what environment a disk extension's
 * spawned process is allowed to see". It is consumed by BOTH child-spawn sites:
 *   - the extension `utilityProcess` (`spawn-child.ts` → `utilityProcess.fork`),
 *     whose child would otherwise clone the WHOLE main-process env; and
 *   - the brokered `ctx.exec` (`broker-caps.ts` → `execFile`), which runs
 *     host-side in main and, with no `env` option, would inherit main's full
 *     `process.env` — leaking every secret the host holds (ANTHROPIC_API_KEY,
 *     AWS_*, SSH agent vars, SF/GitHub tokens) to an extension that merely calls
 *     `ctx.exec('printenv')`.
 *
 * Kept ELECTRON-FREE so it can be imported by the unit-tested broker-caps.ts
 * (spawn-child.ts imports `electron` and can't be pulled in there).
 *
 * Each entry is here for a documented reason — nothing is included "just in
 * case". Anything NOT on this list (every token/credential) is dropped.
 */
export const CHILD_ENV_ALLOWLIST: readonly string[] = [
  // --- process basics an extension legitimately needs ---
  'PATH', //  resolve brokered exec binaries (sf, git, …) — without it the child can't find anything
  'HOME', //  many CLIs/Node libs read $HOME for config/cache; absent → odd failures
  'USER', //  some tools label output / temp paths by user
  'SHELL', // exec'd tools occasionally consult $SHELL
  'TMPDIR', // Node os.tmpdir() + tooling temp files
  'TERM', //  child stdio is 'inherit'; tools probe $TERM for color/tty behaviour
  'LANG', //  locale — keeps text/encoding sane in child output
  'LC_ALL', //  locale override (set when present)
  'LC_CTYPE', // locale char classification (macOS Terminal commonly sets only this)
  'NODE_ENV', // libraries branch dev/prod on it; harmless, no secret

  // --- Electron/Chromium bootstrap the utilityProcess child needs to START ---
  // utilityProcess children run the Electron node binary as a pure Node
  // process; Electron sets ELECTRON_RUN_AS_NODE in the child itself, but the
  // few vars below, when the host has them, are what let the embedded runtime
  // locate its resources / sandbox helper. We forward them ONLY if present so a
  // normal (non-special) launch passes nothing extra. None are secrets.
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NODE_OPTIONS',
  'ELECTRON_DEFAULT_ERROR_MODE',
  'CHROME_DESKTOP'
];

/**
 * Build the trimmed child env from `source` (defaults to the current
 * `process.env`), copying ONLY the allowlisted keys that are actually set.
 * Returns a fresh object — never the live env.
 */
export function buildChildEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const val = source[key];
    if (typeof val === 'string') env[key] = val;
  }
  return env;
}
