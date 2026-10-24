#!/usr/bin/env node
/**
 * Bundle join-cli.ts into a single Node ESM file for /install/zcc-host.tgz,
 * plus the provider-bridge worker and Pi bridge the packed daemon must spawn
 * without a workspace node_modules (no import.meta.resolve of
 * @zana-ai/zcc-provider-bridge-protocol or tsx).
 *
 * Native node-pty's portable prebuilds travel inside the bundle, independent
 * of this laptop's rebuilt addon. CJS deps that call require() are wired
 * through createRequire so the bundle can load Node builtins.
 * Also bundle the minimal peer-only test helper from join-standalone.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { packedPtyFiles } from './packed-pty-files.mjs';

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
const BRIDGE_WORKER_FILE = 'zcc-provider-bridge-worker.mjs';
/** Keep in lockstep with packages/agent-runtime/src/provider-registry.ts */
const PI_BRIDGE_FILE = 'zcc-pi-bridge.mjs';
const PLUGIN_WORKER_FILE = 'zcc-plugin-host-worker.mjs';

const outDir = dirname(outfile);
mkdirSync(outDir, { recursive: true });

const alias = {
  'node-pty': join(packageRoot, 'src/packed-native-pty.ts'),
  '@zcc/harness-sdk': join(repoRoot, 'packages/harness-sdk/src/index.ts'),
  'better-sqlite3': join(packageRoot, 'src/better-sqlite3-stub.ts')
};

const shared = {
  absWorkingDir: packageRoot,
  alias,
  define: { __ZCC_PACKED_PTY_FILES__: JSON.stringify(packedPtyFiles()) },
  bundle: true,
  conditions: ['source'],
  format: 'esm',
  legalComments: 'none',
  banner: { js: `/*! BB-derived code: MIT license\n${readFileSync(join(repoRoot, 'docs/third-party/BB-LICENSE'), 'utf8')}\n*/` },
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
  entryPoints: [join(packageRoot, 'src/join-standalone.ts')],
  outfile: join(outDir, 'join-standalone.mjs')
});
await build({
  ...shared,
  entryPoints: [join(repoRoot, 'packages/provider-bridge-protocol/src/bridge-worker-entry.ts')],
  outfile: join(outDir, BRIDGE_WORKER_FILE)
});
await build({
  ...shared,
  // Launch the host's Pi CLI so its native packages and extension API stay
  // aligned with the runtime the user installed. Never inline an older SDK.
  entryPoints: [join(repoRoot, 'plugins/provider-pi/src/bridge/bridge.ts')],
  outfile: join(outDir, PI_BRIDGE_FILE)
});

await build({
  ...shared,
  entryPoints: [join(packageRoot, 'src/plugin-host-worker.ts')],
  outfile: join(outDir, PLUGIN_WORKER_FILE)
});

function finalizeNodeEsmBundle(path) {
  const requireShim = `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
`;
  let text = readFileSync(path, 'utf8');
  if (text.startsWith('#!')) {
    text = text.slice(text.indexOf('\n') + 1);
  }
  text = text.replace(
    /throw Error\('Dynamic require of "' \+ (\w+) \+ '" is not supported'\);/g,
    'return require($1);'
  );
  // esbuild may emit `import { createRequire }` in the middle of the bundle.
  // A second unaliased import of the same binding is a SyntaxError, and
  // skipping the shim leaves esbuild's `typeof require` helper undefined.
  text = text.replace(/^import \{ createRequire \} from ["']node:module["'];\n/gm, '');
  text = `${requireShim}${text}`;
  writeFileSync(path, `#!/usr/bin/env node\n${text}`);
}

finalizeNodeEsmBundle(outfile);
finalizeNodeEsmBundle(join(outDir, 'join-standalone.mjs'));
finalizeNodeEsmBundle(join(outDir, BRIDGE_WORKER_FILE));
finalizeNodeEsmBundle(join(outDir, PI_BRIDGE_FILE));

finalizeNodeEsmBundle(join(outDir, PLUGIN_WORKER_FILE));
