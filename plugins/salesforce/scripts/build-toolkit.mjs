import { createHash, randomUUID } from 'node:crypto';
import { createRequire, isBuiltin } from 'node:module';
import { readFile, readdir, mkdir, cp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(pluginRoot, 'package.json'));

/** Only runtime built-ins may remain outside the isolated toolkit bundle. */
export function assertToolkitImports(outputs) {
  for (const item of Object.values(outputs)) for (const dependency of item.imports) {
    // Node 22's builtinModules omits prefix-only modules such as node:sqlite.
    if (dependency.external && !isBuiltin(dependency.path)) throw Error(`Unbundled toolkit dependency: ${dependency.path}`);
  }
}

/** Keep the SDK's import.meta.url assets separate from the host's server bundle. */
export async function buildToolkitRuntime(output = join(pluginRoot, 'toolkit-runtime')) {
  const tarball = await readFile(join(pluginRoot, 'vendor/sf-agentic-tools-0.1.0.tgz'));
  const manifest = JSON.parse(await readFile(join(pluginRoot, 'vendor/release-manifest.json'), 'utf8'));
  if (createHash('sha256').update(tarball).digest('hex') !== manifest.assets.find(a => a.name.endsWith('.tgz')).sha256) throw Error('Toolkit release integrity mismatch');
  const catalog = await readFile(join(pluginRoot, 'vendor/catalog.json'));
  if (createHash('sha256').update(catalog).digest('hex') !== manifest.assets.find(a => a.name.endsWith('-catalog.json')).sha256) throw Error('Toolkit catalog integrity mismatch');
  const lockHash = createHash('sha256').update(await readFile(join(pluginRoot, '../../pnpm-lock.yaml'))).digest('hex');
  const stamp = `${manifest.sourceCommit}:${lockHash}:8`;
  if (await readFile(join(output, 'build-stamp'), 'utf8').catch(() => '') === stamp && await stat(join(output, 'sdk.mjs')).catch(() => null)) return;
  const stage = `${output}.stage-${randomUUID()}`;
  await mkdir(stage, { recursive: true });
  const packageRoot = dirname(require.resolve('sf-agentic-tools/package.json'));
  const resourcePackages = new Map();
  const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild');
  try {
    const result = await esbuild.build({
      // Core's default Pino logger launches relative worker scripts. Use its
      // public memory-logger mode inside this isolated bundle instead. Retain
      // only errors and cap the buffer below; never mutate host process.env.
      stdin: { contents: 'import { Logger, LoggerLevel } from "@salesforce/core"; new Logger({ name: Logger.ROOT_NAME, useMemoryLogger: true, level: LoggerLevel.ERROR }); export * from "./dist/index.js";', resolveDir: packageRoot, sourcefile: 'toolkit-runtime-entry.mjs', loader: 'js' },
      outfile: join(stage, 'sdk.mjs'), bundle: true,
      format: 'esm', platform: 'node', target: 'node22', minify: true, metafile: true,
      banner: { js: 'import { createRequire as __zccCreateRequire } from "node:module"; const require = __zccCreateRequire(import.meta.url); const __zccSfRuntimeUrl = import.meta.url;' },
      plugins: [{
        name: 'toolkit-package-resource-directories',
        setup(build) {
          build.onLoad({ filter: /\.[cm]?js$/ }, async args => {
            let source = await readFile(args.path, 'utf8');
            if (args.path.startsWith(packageRoot + '/') && source.includes('import(AGENTFORCE_SDK_PACKAGE)')) {
              // This computed import evades esbuild's dependency graph and
              // otherwise silently depends on the development node_modules.
              if (!source.includes('AGENTFORCE_SDK_PACKAGE = "@sf-agentscript/agentforce"')) throw Error('Toolkit Agent Script SDK contract changed');
              source = source.replaceAll('import(AGENTFORCE_SDK_PACKAGE)', 'import("@sf-agentscript/agentforce")');
              return { contents: source, loader: 'js' };
            }
            if (args.path.endsWith('/@salesforce/core/lib/logger/memoryLogger.js')) {
              if (!source.includes('this.loggedData.push(')) throw Error('Toolkit logger buffer contract changed');
              source = source.replace('this.loggedData.push(', 'if (this.loggedData.length >= 64) this.loggedData.shift(); this.loggedData.push(');
              return { contents: source, loader: 'js' };
            }
            if (!source.includes('__dirname') || args.path.startsWith(packageRoot + '/')) return;
            let root = dirname(args.path);
            while (!(await stat(join(root, 'package.json')).catch(() => null))) {
              const parent = dirname(root); if (parent === root) throw Error('Cannot resolve package resource directory'); root = parent;
            }
            const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
            const id = createHash('sha256').update(`${pkg.name}@${pkg.version}`).digest('hex').slice(0, 16);
            resourcePackages.set(root, id);
            const resource = `./resources/${id}/${relative(root, dirname(args.path)).split('\\').join('/')}/`;
            const transformed = await esbuild.transform(source, {
              loader: 'js', target: 'node22', define: { __dirname: '__sfPackageDir' },
              banner: `const __sfPackageDir = require('node:url').fileURLToPath(new URL(${JSON.stringify(resource)}, __zccSfRuntimeUrl));`
            });
            return { contents: transformed.code, loader: 'js' };
          });
        }
      }], logLevel: 'warning'
    });
    assertToolkitImports(result.metafile.outputs);
    await cp(join(packageRoot, 'dist/assets'), join(stage, 'assets'), { recursive: true });
    for (const [root, id] of resourcePackages) await copyResources(root, join(stage, 'resources', id));
    await writeBundledNotices(result.metafile.inputs, stage);
    for (const name of ['LICENSE.txt', 'NOTICE']) await cp(join(packageRoot, name), join(stage, name));
    await cp(join(pluginRoot, 'vendor/release-manifest.json'), join(stage, 'release-manifest.json'));
    await writeFile(join(stage, 'build-stamp'), stamp);
    await rm(output, { recursive: true, force: true });
    await rename(stage, output);
  } finally { await rm(stage, { recursive: true, force: true }); }
}

async function writeBundledNotices(inputs, output) {
  const packages = new Map();
  for (const file of Object.keys(inputs)) {
    if (file.startsWith('<') || !await stat(file).catch(() => null)) continue;
    let root = dirname(resolve(file));
    while (!await stat(join(root, 'package.json')).catch(() => null)) {
      const parent = dirname(root); if (parent === root) { root = ''; break; } root = parent;
    }
    if (root && !packages.has(root)) packages.set(root, JSON.parse(await readFile(join(root, 'package.json'), 'utf8')));
  }
  const notices = ['# Bundled dependency notices'];
  for (const [root, pkg] of [...packages].sort((a, b) => `${a[1].name}@${a[1].version}`.localeCompare(`${b[1].name}@${b[1].version}`))) {
    notices.push(`## ${pkg.name} ${pkg.version}\n\nLicense: ${typeof pkg.license === 'string' ? pkg.license : 'See upstream notices'}`);
    for (const file of await readdir(root)) if (/^(?:licen[sc]e|copying|notice)(?:[.-]|$)/i.test(file) && (await stat(join(root, file))).isFile()) {
      notices.push(`### ${file}\n\n${await readFile(join(root, file), 'utf8')}`);
    }
  }
  await writeFile(join(output, 'THIRD_PARTY_NOTICES.md'), notices.join('\n\n'));
}

async function copyResources(root, output) {
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (item.name === 'node_modules' || item.name.startsWith('.')) continue;
    const source = join(root, item.name), destination = join(output, item.name);
    if (item.isDirectory()) await copyResources(source, destination);
    else if (item.isFile() && !/\.(?:[cm]?js|[cm]?ts|map|tsx|jsx)$/.test(item.name)) {
      await mkdir(dirname(destination), { recursive: true }); await cp(source, destination);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildToolkitRuntime();
