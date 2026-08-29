#!/usr/bin/env node
/**
 * Bundle join-cli.ts into a single Node ESM file for /install/zcc-host.tgz,
 * plus the provider-bridge worker and Pi bridge the packed daemon must spawn
 * without a workspace node_modules (no import.meta.resolve of
 * @zana-ai/zcc-provider-bridge-protocol or tsx).
 *
 * Native node-pty is aliased to a pipe shim so Linux remotes do not need a
 * matching pty.node from this laptop. CJS deps that call require() are wired
 * through createRequire so the bundle can load Node builtins.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageRoot, '../..');
const outfileFlag = process.argv.indexOf('--outfile');
const outfile = outfileFlag >= 0
  ? process.argv[outfileFlag + 1]
  : join(packageRoot, 'dist', 'join.mjs');

if (!outfile) {
  console.error('build-join: --outfile requires a path');
  process.exit(2);
}

/** Keep in lockstep with packages/agent-runtime/src/shared/bridge-path.ts */
const BRIDGE_WORKER_FILE = 'bb-provider-bridge-worker.mjs';
/** Keep in lockstep with packages/agent-runtime/src/provider-registry.ts */
const PI_BRIDGE_FILE = 'bb-pi-bridge.mjs';

const outDir = dirname(outfile);
mkdirSync(outDir, { recursive: true });

const alias = {
  'node-pty': join(packageRoot, 'src/pty-pipe-shim.ts'),
  '@zcc/harness-sdk': join(repoRoot, 'packages/harness-sdk/src/index.ts'),
  'better-sqlite3': join(packageRoot, 'src/better-sqlite3-stub.ts')
};

const shared = {
  absWorkingDir: packageRoot,
  alias,
  bundle: true,
  conditions: ['source'],
  format: 'esm',
  legalComments: 'none',
  platform: 'node',
  sourcemap: false,
  target: 'node22'
};

await build({
  ...shared,
  entryPoints: [join(packageRoot, 'src/join-cli.ts')],
  outfile
});
await build({
  ...shared,
  entryPoints: [join(repoRoot, 'packages/provider-bridge-protocol/src/bridge-worker-entry.ts')],
  outfile: join(outDir, BRIDGE_WORKER_FILE)
});
await build({
  ...shared,
  entryPoints: [join(repoRoot, 'packages/agent-runtime/src/pi/bridge/bridge.ts')],
  outfile: join(outDir, PI_BRIDGE_FILE)
});

function finalizeNodeEsmBundle(path) {
  const requireShim = `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
`;
  let text = readFileSync(path, 'utf8');
  text = text.replace(
    /throw Error\('Dynamic require of "' \+ (\w+) \+ '" is not supported'\);/g,
    'return require($1);'
  );
  if (!text.includes("from 'node:module'")) {
    text = `#!/usr/bin/env node\n${requireShim}${text}`;
  } else if (!text.startsWith('#!')) {
    text = `#!/usr/bin/env node\n${text}`;
  }
  writeFileSync(path, text);
}

finalizeNodeEsmBundle(outfile);
finalizeNodeEsmBundle(join(outDir, BRIDGE_WORKER_FILE));
finalizeNodeEsmBundle(join(outDir, PI_BRIDGE_FILE));
