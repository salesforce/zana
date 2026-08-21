#!/usr/bin/env node
/**
 * Build + package every first-party plugin under `plugins/*` that still needs
 * a compile step, so a cold `npm run dev` never loads a stale bundle. Plugins
 * that ship as source (docs: package.json + server.mjs + skills) skip this —
 * PluginService auto-installs them from `plugins/<id>` in place.
 *
 * Extension-agnostic by design (engineering rule #6): it discovers plugins
 * by scanning `plugins/*` for a `package.json` with both `build` and
 * `package` scripts — it never hard-codes an id. Best-effort per plugin: one
 * failing build logs and does not abort the others (or the app launch).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const extsRoot = join(repoRoot, 'plugins');

if (!existsSync(extsRoot)) process.exit(0);

const dirs = readdirSync(extsRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  .map((e) => e.name);

let failures = 0;
for (const name of dirs) {
  const pkgPath = join(extsRoot, name, 'package.json');
  if (!existsSync(pkgPath)) continue;
  let scripts = {};
  try {
    scripts = JSON.parse(readFileSync(pkgPath, 'utf-8')).scripts ?? {};
  } catch {
    continue;
  }
  // Only seed extensions that follow the build+package convention.
  if (!scripts.build || !scripts.package) continue;

  const cwd = join(extsRoot, name);
  process.stdout.write(`[seed-extensions] ${name}: build+package… `);
  const build = spawnSync('npm', ['run', 'build', '--silent'], { cwd, stdio: 'inherit' });
  if (build.status !== 0) {
    failures++;
    console.error(`\n[seed-extensions] ${name}: build failed — skipping`);
    continue;
  }
  const pkg = spawnSync('npm', ['run', 'package', '--silent'], { cwd, stdio: 'inherit' });
  if (pkg.status !== 0) {
    failures++;
    console.error(`\n[seed-extensions] ${name}: package failed`);
    continue;
  }
  console.log('ok');
}

// Never block the app launch: log and exit 0 even if some extensions failed.
if (failures) console.error(`[seed-extensions] ${failures} extension(s) failed to seed (continuing)`);
process.exit(0);
