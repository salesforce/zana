#!/usr/bin/env node
/**
 * Copy BB thread-runtime packages into this workspace and rebrand @bb/* → @zana-ai/zcc-*.
 * Source: sibling checkout create-new-project-based-20260818132018
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
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
  ['@bb/domain/thread-status', '@zana-ai/zcc-domain/thread-runtime'],
  ['@bb/domain/thread-origin-kind', '@zana-ai/zcc-domain/thread-runtime'],
  ['@bb/domain/thread-visibility', '@zana-ai/zcc-domain/thread-runtime'],
  ['@bb/domain/plugin-cli', '@zana-ai/zcc-domain/thread-runtime'],
  ['@bb/domain/plugin-icon', '@zana-ai/zcc-domain/thread-runtime'],
  ['@bb/domain/provider-fork', '@zana-ai/zcc-domain/thread-runtime'],
  ['@bb/domain/plugin-interaction-limits', '@zana-ai/zcc-domain/thread-runtime'],
  ['@bb/domain', '@zana-ai/zcc-domain/thread-runtime'],
  ['@bb/tsconfig', '@zana-ai/zcc-tsconfig'],
  ['@bb/plugin-build', '@zana-ai/zcc-plugin-sdk'],
  ['@bb/test-helpers', '@zana-ai/zcc-agent-runtime']
];

const SKIP_DIR = new Set(['node_modules', 'dist', '.turbo', 'coverage']);

function rebrand(text) {
  let out = text;
  for (const [from, to] of REPLACEMENTS) {
    out = out.split(from).join(to);
  }
  return out;
}

function copyTree(src, dest, { rebrandFiles = true } = {}) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (SKIP_DIR.has(name) || name === 'tsconfig.tsbuildinfo') continue;
    const from = join(src, name);
    const to = join(dest, name);
    const st = statSync(from);
    if (st.isDirectory()) {
      copyTree(from, to, { rebrandFiles });
      continue;
    }
    if (!rebrandFiles || !/\.(ts|tsx|js|mjs|cjs|json|md)$/.test(name)) {
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

const domainDest = join(ROOT, 'packages/domain/src/bb-thread');
rmSync(domainDest, { recursive: true, force: true });
copyTree(join(BB, 'packages/domain/src'), domainDest);
writeFileSync(
  join(ROOT, 'packages/domain/src/thread-runtime.ts'),
  `/** BB thread/runtime domain surface. Isolated from product.ts / TerminalSession. */\nexport * from './bb-thread/index.js';\n`
);

const packages = [
  ['packages/provider-bridge-protocol', 'packages/provider-bridge-protocol', '@zana-ai/zcc-provider-bridge-protocol'],
  ['packages/host-daemon-contract', 'packages/host-daemon-contract', '@zana-ai/zcc-host-daemon-contract'],
  ['packages/server-contract', 'packages/server-contract', '@zana-ai/zcc-server-contract'],
  ['packages/hono-typed-routes', 'packages/hono-typed-routes', '@zana-ai/zcc-hono-typed-routes'],
  ['packages/process-utils', 'packages/agent-process-utils', '@zana-ai/zcc-agent-process-utils'],
  ['packages/agent-runtime', 'packages/agent-runtime', '@zana-ai/zcc-agent-runtime'],
  ['packages/thread-view', 'packages/thread-view', '@zana-ai/zcc-thread-view']
];

for (const [fromRel, toRel, name] of packages) {
  const dest = join(ROOT, toRel);
  rmSync(dest, { recursive: true, force: true });
  copyTree(join(BB, fromRel), dest);
  const pkgPath = join(dest, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.name = name;
  pkg.private = true;
  pkg.version = '0.1.0';
  delete pkg.publishConfig;
  if (pkg.dependencies) {
    for (const key of Object.keys(pkg.dependencies)) {
      if (key.startsWith('@zana-ai/zcc-')) pkg.dependencies[key] = 'workspace:*';
    }
  }
  if (pkg.devDependencies) {
    for (const key of Object.keys(pkg.devDependencies)) {
      if (key.startsWith('@zana-ai/zcc-')) pkg.devDependencies[key] = 'workspace:*';
      if (key === 'typescript' || key === 'typescript-7') {
        pkg.devDependencies[key] = '^7.0.2';
      }
      if (key === 'vitest') pkg.devDependencies[key] = '^4.1.10';
      if (key === '@types/node') pkg.devDependencies[key] = '^26.2.0';
    }
    delete pkg.devDependencies['@zana-ai/zcc-plugin-sdk'];
    if (name === '@zana-ai/zcc-agent-runtime') {
      delete pkg.devDependencies['@zana-ai/zcc-agent-runtime'];
    }
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(
    join(dest, 'tsconfig.json'),
    `${JSON.stringify({
      extends: ['@zana-ai/zcc-tsconfig/base.json', '@zana-ai/zcc-tsconfig/typecheck-overrides.json'],
      compilerOptions: { rootDir: '.', types: ['node'] },
      include: ['src', 'test', 'tests']
    }, null, 2)}\n`
  );
}

console.log('copied BB thread packages into', relative(ROOT, join(ROOT, 'packages')));
