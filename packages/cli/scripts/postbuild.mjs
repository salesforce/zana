#!/usr/bin/env node
/**
 * Post-build step for @zcc/cli.
 *
 * `tsc` compiles `src/bin/zcc.ts` -> `dist/bin/zcc.js` (with the `.js`
 * extension). But a shell resolving a BARE `zcc` on PATH needs an executable
 * file literally named `zcc` (no extension) — the `.js` file is invisible to
 * `command -v zcc`. In dev the only such file is the npm workspace symlink
 * `node_modules/.bin/zcc`; in a packaged Electron app there is none at all
 * (electron-builder `extraResources` copies `dist/` -> `zcc-cli/`, giving
 * `resourcesPath/zcc-cli/bin/zcc.js` and, again, no bare `zcc`).
 *
 * This script emits the missing pieces INSIDE the CLI's own build so BOTH dev
 * and packaged runtimes get them:
 *
 *   1. `dist/bin/zcc` — an extensionless, executable copy of `zcc.js`. It is a
 *      self-contained copy (carries the `#!/usr/bin/env node` shebang and the
 *      relative `../lib/run-cli.js` import), so it runs correctly from wherever
 *      `dist/bin` lands. This is the file the PATH resolver in
 *      `src/main/env.ts` (`resolveZccCliBinDir`) gates on.
 *
 *   2. `dist/package.json` = `{"type":"module"}`. The compiled output is ESM
 *      (static `import`). In dev the parent `packages/cli/package.json`
 *      (`"type":"module"`) supplies that, but only `dist/` is copied into the
 *      packaged app, so without this marker Node would treat the `.js` files as
 *      CommonJS and the `import` statements would throw. Shipping it makes the
 *      packaged CLI resolve as ESM identically to dev.
 *
 * Keeping this in the CLI package (not the Electron build) means the extension-
 * less launcher exists the moment `npm run build:cli` runs — dev, CI, and the
 * packaged app all go through the same path.
 */
import { chmodSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const binDir = join(distDir, 'bin');
const zccJs = join(binDir, 'zcc.js');

if (!existsSync(zccJs)) {
  console.error(`[postbuild] expected ${zccJs} — did tsc run?`);
  process.exit(1);
}

// 1. Extensionless, executable launcher named exactly `zcc`.
const zccBare = join(binDir, 'zcc');
copyFileSync(zccJs, zccBare);
chmodSync(zccBare, 0o755);

// 2. ESM marker so the compiled output resolves as ESM even when only `dist/`
//    is copied (packaged app), where the parent package.json is absent.
writeFileSync(join(distDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');

console.log(`[postbuild] wrote ${zccBare} (0755) and dist/package.json`);
