#!/usr/bin/env node
/**
 * Copy BB provider plugins + plugin-sdk provider-bridge facade.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)));
const BB = join(dirname(ROOT), 'create-new-project-based-20260818132018');

const REPLACEMENTS = [
  ['@get-bb/plugin-sdk', '@zana-ai/zcc-plugin-sdk'],
  ['@bb/provider-bridge-protocol', '@zana-ai/zcc-provider-bridge-protocol'],
  ['@bb/host-daemon-contract', '@zana-ai/zcc-host-daemon-contract'],
  ['@bb/server-contract', '@zana-ai/zcc-server-contract'],
  ['@bb/hono-typed-routes', '@zana-ai/zcc-hono-typed-routes'],
  ['@bb/process-utils', '@zana-ai/zcc-agent-process-utils'],
  ['@bb/agent-runtime', '@zana-ai/zcc-agent-runtime'],
  ['@bb/thread-view', '@zana-ai/zcc-thread-view'],
  ['@bb/domain', '@zana-ai/zcc-domain/thread-runtime'],
  ['@bb/tsconfig', '@zana-ai/zcc-tsconfig'],
  ['BbPluginApi', 'ZccPluginApi'],
  ['type ZccPluginApi', 'type ZccPluginApi']
];

const SKIP_DIR = new Set(['node_modules', 'dist', '.turbo', 'coverage']);

function rebrand(text) {
  let out = text;
  for (const [from, to] of REPLACEMENTS) {
    out = out.split(from).join(to);
  }
  return out;
}

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (SKIP_DIR.has(name) || name === 'tsconfig.tsbuildinfo') continue;
    const from = join(src, name);
    const to = join(dest, name);
    const st = statSync(from);
    if (st.isDirectory()) {
      copyTree(from, to);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs|cjs|json|md|svg)$/.test(name)) {
      cpSync(from, to);
      continue;
    }
    const raw = readFileSync(from, 'utf8');
    writeFileSync(to, rebrand(raw));
  }
}

if (!existsSync(BB)) {
  throw new Error(`BB source missing at ${BB}`);
}

const bridgeSrc = join(BB, 'packages/plugin-sdk/src/provider-bridge.ts');
const bridgeDest = join(ROOT, 'packages/plugin-sdk/src/provider-bridge.ts');
writeFileSync(bridgeDest, rebrand(readFileSync(bridgeSrc, 'utf8')));

const plugins = [
  'provider-claude-code',
  'provider-codex',
  'provider-pi',
  'provider-acp'
];

for (const name of plugins) {
  const dest = join(ROOT, 'plugins', name);
  rmSync(dest, { recursive: true, force: true });
  copyTree(join(BB, 'plugins', name), dest);
  const pkgPath = join(dest, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const displayName = pkg.bb?.name ?? name;
  const description = pkg.bb?.description ?? pkg.description ?? name;
  const icon = pkg.bb?.branding?.icon ?? 'Bot';
  pkg.name = `@zcc-ext/${name}`;
  pkg.private = true;
  pkg.version = '0.1.0';
  pkg.engines = { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' };
  pkg.zcc = {
    name: displayName,
    description,
    branding: { icon },
    server: pkg.bb?.server ?? './server.ts',
    ...(pkg.bb?.app ? { app: pkg.bb.app } : {}),
    host: pkg.bb?.host ?? './src/bridge/bridge.ts',
    extra: { threadProvider: true }
  };
  delete pkg.bb;
  delete pkg.keywords;
  if (pkg.dependencies) {
    for (const key of Object.keys(pkg.dependencies)) {
      if (key.startsWith('@zana-ai/zcc-')) pkg.dependencies[key] = 'workspace:*';
    }
  }
  if (pkg.devDependencies) {
    for (const key of Object.keys(pkg.devDependencies)) {
      if (key.startsWith('@zana-ai/zcc-')) pkg.devDependencies[key] = 'workspace:*';
      if (key === 'typescript' || key === 'typescript-7') pkg.devDependencies[key] = '^7.0.2';
      if (key === 'vitest') pkg.devDependencies[key] = '^4.1.10';
    }
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

console.log('copied provider plugins and plugin-sdk provider-bridge');
