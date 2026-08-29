/**
 * Build the public official marketplace.json from first-party plugin packages.
 * Pointers only (git + subdir) — refresh never executes plugin code.
 *
 * Run automatically via website predev / prebuild. Re-run by hand with
 * `node scripts/generate-marketplace.mjs`. When plugins/ is unreachable
 * (website Docker context), keep the committed content/marketplace copy.
 */
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBSITE = join(HERE, '..');
const REPO_ROOT = join(WEBSITE, '..');
const PLUGINS_ROOT = join(REPO_ROOT, 'plugins');
const OUT_DIR = join(WEBSITE, 'content', 'marketplace');
const OUT_FILE = join(OUT_DIR, 'marketplace.json');
const REPO_GIT = 'https://github.com/salesforce/zana';

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function derivePluginId(packageName) {
  const base = packageName.includes('/')
    ? (packageName.split('/').at(-1) ?? packageName)
    : packageName;
  const id = String(base)
    .replace(/^(zcc|zana)-plugin-/, '')
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');
  if (id.length === 0 || !PLUGIN_ID_PATTERN.test(id)) {
    throw new Error(`cannot derive a plugin id from package name "${packageName}"`);
  }
  return id;
}

export function pluginEntryFromPackage(pkg, dirName) {
  const zcc = pkg?.zcc;
  if (!pkg || typeof pkg.name !== 'string' || !zcc || typeof zcc !== 'object') return null;
  const id = derivePluginId(pkg.name);
  if (id !== dirName) return null;
  const displayName = typeof zcc.name === 'string' && zcc.name.trim() ? zcc.name.trim() : id;
  const description =
    (typeof zcc.description === 'string' && zcc.description.trim()) ||
    (typeof pkg.description === 'string' && pkg.description.trim()) ||
    `${displayName} plugin`;
  const icon =
    typeof zcc.branding?.icon === 'string' && zcc.branding.icon.trim()
      ? { lucide: zcc.branding.icon.trim() }
      : undefined;
  return {
    id,
    displayName,
    description,
    ...(icon ? { icon } : {}),
    tags: ['official'],
    author: { name: 'Zana', github: 'salesforce', url: REPO_GIT },
    source: {
      git: {
        url: REPO_GIT,
        subdir: `plugins/${id}`,
        ref: 'HEAD'
      }
    }
  };
}

export function buildOfficialMarketplace(entries) {
  return {
    schemaVersion: 1,
    name: 'official',
    displayName: 'Zana official plugins',
    description: 'First-party plugins shipped with Zana Command Center',
    plugins: [...entries].sort((a, b) => a.displayName.localeCompare(b.displayName))
  };
}

export function readFirstPartyPluginEntries(pluginsRoot = PLUGINS_ROOT) {
  if (!existsSync(pluginsRoot)) return [];
  const names = readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);
  const entries = [];
  for (const name of names) {
    const pkgPath = join(pluginsRoot, name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const entry = pluginEntryFromPackage(pkg, name);
      if (entry) entries.push(entry);
    } catch {
      /* skip malformed package.json */
    }
  }
  return entries;
}

function isMain() {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(invoked);
  } catch {
    return false;
  }
}

if (isMain()) {
  if (!existsSync(PLUGINS_ROOT) && existsSync(OUT_FILE)) {
    console.log('generate-marketplace: plugins/ not reachable; keeping committed marketplace.json');
    process.exit(0);
  }
  const index = buildOfficialMarketplace(readFirstPartyPluginEntries());
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`generate-marketplace: wrote ${index.plugins.length} plugins → content/marketplace/marketplace.json`);
}
