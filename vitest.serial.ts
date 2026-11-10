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
  String.raw`\besbuild\b`,
  String.raw`electron-vite`,
  // agent-runtime's fake provider is a real child process.
  String.raw`\bfakeProviderScriptPath\b`
].join('|'));

/** Spawn through an imported helper; the source pattern cannot see these. */
export const SERIAL_TEST_FILES: readonly string[] = [
  // Native Codex credential fixtures launch real helpers through a portable wrapper.
  'apps/host-daemon/src/codex-auth-native.test.ts',
  'apps/host-daemon/src/codex-auth-storage.test.ts',
  // createGhRunner spawns real node children under a 150ms timeout.
  'plugins/github/src/credentials.test.ts',
  // History-query workers share a module-level capacity queue across test files.
  'apps/server/src/services/threads/history-query-worker.test.ts',
  'apps/server/src/services/threads/history-query-worker.failure.test.ts',
  // Real filesystem-watch teardown needs an uncontended event loop.
  'apps/server/src/services/extensions/__tests__/local-extension-hot-reload.integration.test.ts',
  // These fixtures create thousands of files or execute a fake SSH filesystem.
  'apps/server/src/services/projects/__tests__/fs-scan.test.ts',
  'apps/host-daemon/src/remote-fs.test.ts',
  // 24 MiB plugin-worker transfers are CPU-bound and hit a 5 s limit on a busy machine (#693).
  'apps/server/src/plugins/isolated-plugin-runtime.test.ts',
  // Real authenticated gateway on loopback with 8 MiB bodies under a 3 s request timeout.
  'services/mobile-relay/relay.test.ts',
  // Appends megabytes of 250k-character titles to check the retention bounds.
  'apps/server/src/services/feed/project-feed.test.ts',
  // Pairing loops use real timers under an explicit 20 s test timeout.
  'plugins/design-docs/src/server/pairing.test.ts',
  // Applies 24 MiB of design-doc files through the production worker fence.
  'plugins/design-docs/src/server/peer-apply-fence.test.ts',
  // The SDK launch-health probe runs fake executables through an imported helper.
  'plugins/provider-acp/src/bridge/acp-health.test.ts',
  // Drives a real fake ACP agent child process through an imported helper.
  'plugins/provider-acp/src/bridge/bridge.test.ts',
  // Runs real git through the imported runGit helper.
  'packages/host-workspace/src/worktree-start-point.test.ts',
  // Creates hundreds of file-store records and transitions in a single file.
  'apps/server/src/services/execution/__tests__/execution-store.test.ts'
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
