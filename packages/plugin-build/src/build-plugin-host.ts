import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { createPluginArtifactMeta } from './build-plugin.js';

const PLUGIN_SDK_PACKAGE = '@zana-ai/zcc-plugin-sdk';
const PLUGIN_SDK_HOST = '@zana-ai/zcc-plugin-sdk/host';
const PLUGIN_SDK_PROVIDER_BRIDGE = '@zana-ai/zcc-plugin-sdk/provider-bridge';
const PLUGIN_SDK_RUNTIME_NAMESPACE = 'zcc-host-sdk-runtime';
const PLUGIN_SDK_HOST_FALLBACK_NAMESPACE = 'zcc-host-sdk-fallback';
const HOST_STAGE_DIRECTORY_PREFIX = '.host-stage-';
const HOST_STAGE_STALE_AFTER_MS = 60 * 60 * 1_000;

const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  'const require = __createRequire(import.meta.url);',
  'var __filename = __fileURLToPath(import.meta.url);',
  'var __dirname = __pathDirname(__filename);'
].join('\n');

const PLUGIN_SDK_DEFINE_HOST_ENTRY_RUNTIME = `
export function experimental_defineHostEntry(setup) {
  return { __zccPluginHost: true, setup };
}
export function isPluginHostEntryDefinition(value) {
  return typeof value === "object" && value !== null && value.__zccPluginHost === true && typeof value.setup === "function";
}
`;

const PLUGIN_SDK_ROOT_RUNTIME = `
export const PLUGIN_CLI_OUTPUT_MAX_BYTES = 1024 * 1024;
export function defineRpcContract(contract) { return contract; }
${PLUGIN_SDK_DEFINE_HOST_ENTRY_RUNTIME}
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containedIn(rootDir: string, candidate: string): boolean {
  const root = resolve(rootDir);
  const path = resolve(candidate);
  return path === root || path.startsWith(root + sep);
}

function privateZccImportError(specifier: string): string {
  return (
    `host entries cannot import private ZCC workspace package "${specifier}"; ` +
    `use ${PLUGIN_SDK_PACKAGE}, ${PLUGIN_SDK_PROVIDER_BRIDGE}, Node APIs, or a regular plugin dependency`
  );
}

function isPluginSdkSpecifier(specifier: string): boolean {
  return specifier === PLUGIN_SDK_PACKAGE || specifier.startsWith(`${PLUGIN_SDK_PACKAGE}/`);
}

function isAllowedPluginSdkSpecifier(specifier: string): boolean {
  return (
    specifier === PLUGIN_SDK_PACKAGE
    || specifier === PLUGIN_SDK_HOST
    || specifier === PLUGIN_SDK_PROVIDER_BRIDGE
    || specifier.startsWith(`${PLUGIN_SDK_PROVIDER_BRIDGE}/`)
  );
}

interface SourceToken {
  kind: 'identifier' | 'punctuation' | 'string';
  value: string;
}

function sourceTokens(source: string): SourceToken[] {
  const tokens: SourceToken[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? '';
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index + 2);
      if (index === -1) break;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const quote = character;
      let value = '';
      index += 1;
      while (index < source.length) {
        const next = source[index] ?? '';
        if (next === '\\') {
          value += source[index + 1] ?? '';
          index += 2;
          continue;
        }
        if (next === quote) {
          index += 1;
          break;
        }
        value += next;
        index += 1;
      }
      tokens.push({ kind: 'string', value });
      continue;
    }
    if (character === '`') {
      index += 1;
      while (index < source.length) {
        const next = source[index] ?? '';
        if (next === '\\') index += 2;
        else if (next === '`') {
          index += 1;
          break;
        } else index += 1;
      }
      continue;
    }
    if (/[A-Za-z0-9_$]/u.test(character)) {
      const start = index;
      index += 1;
      while (/[A-Za-z0-9_$]/u.test(source[index] ?? '')) index += 1;
      tokens.push({ kind: 'identifier', value: source.slice(start, index) });
      continue;
    }
    tokens.push({ kind: 'punctuation', value: character });
    index += 1;
  }
  return tokens;
}

function sourceImportSpecifiers(source: string): string[] {
  const tokens = sourceTokens(source);
  const specifiers: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== 'string') continue;
    const previous = tokens[index - 1]?.value;
    const callee = previous === '(' ? tokens[index - 2]?.value : undefined;
    if (
      previous === 'from'
      || previous === 'import'
      || callee === 'import'
      || callee === 'require'
    ) {
      specifiers.push(token.value);
    }
  }
  return specifiers;
}

async function owningPackageName(
  filePath: string,
  cache: Map<string, string | null>
): Promise<string | null> {
  let directory = dirname(filePath);
  const visited: string[] = [];
  while (true) {
    if (cache.has(directory)) {
      const cached = cache.get(directory) ?? null;
      for (const entry of visited) cache.set(entry, cached);
      return cached;
    }
    visited.push(directory);
    try {
      const parsed: unknown = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      const name = isRecord(parsed) && typeof parsed.name === 'string' ? parsed.name : null;
      for (const entry of visited) cache.set(entry, name);
      return name;
    } catch {
      const parent = dirname(directory);
      if (parent === directory) {
        for (const entry of visited) cache.set(entry, null);
        return null;
      }
      directory = parent;
    }
  }
}

async function readPluginHostConfig(rootDir: string): Promise<{
  hostEntry: string;
  packageName: string;
  pluginVersion: string;
}> {
  const packageJsonPath = join(rootDir, 'package.json');
  let json: unknown;
  try {
    json = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  } catch {
    throw new Error(`no readable valid package.json at ${packageJsonPath}`);
  }
  if (!isRecord(json) || !isRecord(json.zcc) || json.zcc.host === undefined) {
    throw new Error(`no host entry: ${packageJsonPath} has no "zcc": { "host": "./host.ts" } field`);
  }
  const host = json.zcc.host;
  if (typeof host !== 'string' || host.trim().length === 0) {
    throw new Error(`no host entry in ${packageJsonPath}`);
  }
  if (isAbsolute(host)) {
    throw new Error(`manifest zcc.host must be relative, got "${host}"`);
  }
  const hostEntry = resolve(rootDir, host);
  if (!containedIn(rootDir, hostEntry)) {
    throw new Error(`manifest zcc.host escapes the plugin directory: "${host}"`);
  }
  try {
    await stat(hostEntry);
  } catch {
    throw new Error(`manifest zcc.host points at a missing file: ${host}`);
  }
  const packageName = typeof json.name === 'string' ? json.name : '';
  const pluginVersion = typeof json.version === 'string' ? json.version : '0.0.0';
  if (!packageName) {
    throw new Error(`package.json at ${packageJsonPath} has no name`);
  }
  return { hostEntry, packageName, pluginVersion };
}

export interface PluginHostBuildResult {
  jsPath: string;
  mapPath: string;
  metaPath: string;
  artifactDigest: string;
}

async function removeStaleHostStageDirectories(distDir: string): Promise<void> {
  const entries = await readdir(distDir, { withFileTypes: true }).catch(() => []);
  const staleBefore = Date.now() - HOST_STAGE_STALE_AFTER_MS;
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(HOST_STAGE_DIRECTORY_PREFIX))
      .map(async (entry) => {
        const stageDir = join(distDir, entry.name);
        const stageStats = await stat(stageDir).catch(() => null);
        if (stageStats !== null && stageStats.mtimeMs <= staleBefore) {
          await rm(stageDir, { recursive: true, force: true });
        }
      })
  );
}

function importerIsInsidePlugin(importer: string, rootDir: string): boolean {
  if (!importer) return true;
  return containedIn(rootDir, importer);
}

/** Build the optional Node host entry into a self-contained remote artifact. */
export async function buildPluginHost(
  rootDir: string,
  zccVersion: string
): Promise<PluginHostBuildResult> {
  const { hostEntry, packageName, pluginVersion } = await readPluginHostConfig(rootDir);
  const pluginRoot = await realpath(rootDir);
  const distDir = join(rootDir, 'dist');
  await mkdir(distDir, { recursive: true });
  const jsPath = join(distDir, 'host.js');
  const mapPath = join(distDir, 'host.js.map');
  const metaPath = join(distDir, 'host.meta.json');
  await removeStaleHostStageDirectories(distDir);
  const stageDir = await mkdtemp(join(distDir, HOST_STAGE_DIRECTORY_PREFIX));
  try {
    const stagedJsPath = join(stageDir, 'host.js');
    const esbuild = await import('esbuild');
    const packageNameByDirectory = new Map<string, string | null>();
    await esbuild.build({
      entryPoints: [hostEntry],
      outfile: stagedJsPath,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      // CI / a clean tree has no packages/plugin-sdk/dist. The SDK exports
      // `source` → src/*.ts; without this condition esbuild follows
      // `import` → dist/*.js and `build-plugin-hosts` fails the release.
      conditions: ['source'],
      sourcemap: true,
      banner: { js: NODE_ESM_REQUIRE_BANNER },
      logLevel: 'error',
      plugins: [
        {
          name: 'provide-public-host-sdk-runtime',
          setup(build) {
            build.onResolve({ filter: /^@zana-ai\/zcc-/ }, (args) => {
              if (args.path === PLUGIN_SDK_PACKAGE) {
                return { path: args.path, namespace: PLUGIN_SDK_RUNTIME_NAMESPACE };
              }
              if (args.path === PLUGIN_SDK_HOST) {
                return { path: args.path, namespace: PLUGIN_SDK_HOST_FALLBACK_NAMESPACE };
              }
              if (args.path === PLUGIN_SDK_PROVIDER_BRIDGE || args.path.startsWith(`${PLUGIN_SDK_PROVIDER_BRIDGE}/`)) {
                return undefined;
              }
              if (isPluginSdkSpecifier(args.path) && !isAllowedPluginSdkSpecifier(args.path)) {
                return { errors: [{ text: privateZccImportError(args.path) }] };
              }
              if (importerIsInsidePlugin(args.importer, pluginRoot)) {
                return { errors: [{ text: privateZccImportError(args.path) }] };
              }
              return undefined;
            });
            build.onLoad({ filter: /.*/, namespace: PLUGIN_SDK_RUNTIME_NAMESPACE }, () => ({
              contents: PLUGIN_SDK_ROOT_RUNTIME,
              loader: 'js'
            }));
            build.onLoad({ filter: /.*/, namespace: PLUGIN_SDK_HOST_FALLBACK_NAMESPACE }, () => ({
              contents: PLUGIN_SDK_DEFINE_HOST_ENTRY_RUNTIME,
              loader: 'js'
            }));
          }
        },
        {
          name: 'reject-private-zcc-host-imports',
          setup(build) {
            build.onLoad({ filter: /\.[cm]?(js|ts|jsx|tsx)$/ }, async (args) => {
              const filePath = resolve(args.path);
              if (!containedIn(pluginRoot, filePath)) return undefined;
              const source = await readFile(filePath, 'utf8');
              for (const specifier of sourceImportSpecifiers(source)) {
                if (specifier.startsWith('@zana-ai/zcc-') && !isAllowedPluginSdkSpecifier(specifier)) {
                  return { errors: [{ text: privateZccImportError(specifier) }] };
                }
                if (!specifier.startsWith('.') && !isAbsolute(specifier)) continue;
                const importedPath = resolve(dirname(filePath), specifier);
                const importedOwner = await owningPackageName(importedPath, packageNameByDirectory);
                if (
                  importedOwner
                  && importedOwner.startsWith('@zana-ai/zcc-')
                  && importedOwner !== PLUGIN_SDK_PACKAGE
                ) {
                  return { errors: [{ text: privateZccImportError(importedOwner) }] };
                }
              }
              return undefined;
            });
          }
        }
      ]
    });
    const artifactDigest = createHash('sha256').update(await readFile(stagedJsPath)).digest('hex');
    await rename(stagedJsPath, jsPath);
    await rename(join(stageDir, 'host.js.map'), mapPath);
    await writeFile(
      metaPath,
      `${JSON.stringify(
        {
          ...createPluginArtifactMeta({ packageName, pluginVersion, zccVersion }),
          artifactDigest
        },
        null,
        2
      )}\n`
    );
    return { jsPath, mapPath, metaPath, artifactDigest };
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}
