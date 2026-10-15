import { globSync, readFileSync } from 'node:fs';

/**
 * Test files that start real subprocesses (CLI bridges, shells, native PTYs,
 * git, esbuild, Electron utility runtimes). They run one file at a time after
 * every other file has finished, so their bounded version probes and spawn
 * timeouts never compete with parallel workers for CPU. Everything else runs
 * in parallel.
 *
 * Detection is by source text, so a new test that spawns is serialized without
 * a list edit. A file that spawns only through an imported helper is invisible
 * to the pattern: add it to SERIAL_TEST_FILES.
 */
export const SERIAL_SOURCE_PATTERN = new RegExp([
  String.raw`node:child_process`,
  String.raw`from ['"]child_process['"]`,
  String.raw`node-pty`,
  String.raw`\bspawn(?:Sync)?\(`,
  String.raw`\bexecFile(?:Sync)?\(`,
  String.raw`\bexecSync\(`,
  String.raw`\bfork\(`,
  String.raw`\bPtyManager\b`,
  String.raw`\butilityProcess\b`,
  String.raw`\bstartRuntimeSupervisor\b`,
  String.raw`process\.chdir\(`,
  String.raw`['"]git['"]`,
  String.raw`\besbuild\b`,
  String.raw`electron-vite`,
  // agent-runtime's fake provider is a real child process.
  String.raw`\bfakeProviderScriptPath\b`
].join('|'));

/** Spawn through an imported helper; the source pattern cannot see these. */
export const SERIAL_TEST_FILES: readonly string[] = [
  // createGhRunner spawns real node children under a 150ms timeout.
  'plugins/github/src/credentials.test.ts'
];

/** Never test sources; skipping them keeps the scan fast. The projects' own
 * `exclude` still decides what actually runs. */
const SKIPPED_DIRS = new Set(['node_modules', '.git', '.worktrees', '.claude', '.pnpm-store', '.zcc', 'artifacts', 'e2e', 'e2e-web', 'out', 'out-dev', 'dist', '.next']);

export function serialTestFiles(root: string): string[] {
  const detected = globSync('**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', {
    cwd: root,
    exclude: (path: string) => SKIPPED_DIRS.has(path.split('/').pop() ?? '') || path.split('/').pop()!.startsWith('.builtin-host-test-')
  }).filter((file) => {
    try { return SERIAL_SOURCE_PATTERN.test(readFileSync(`${root}/${file}`, 'utf8')); }
    catch { return false; }
  });
  return [...new Set([...detected, ...SERIAL_TEST_FILES])].sort();
}
