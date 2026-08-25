import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_SDK_API_MAJOR, PLUGIN_SDK_VERSION, derivePluginId } from '@zana-ai/zcc-plugin-sdk';

export interface PluginArtifactMeta {
  sdkMajor: number;
  sdkVersion: string;
  artifactFormatVersion: 1;
  pluginId: string;
  pluginVersion: string;
  builtWith: { zccVersion: string; pluginSdkVersion: string };
}

export function createPluginArtifactMeta(args: {
  packageName: string;
  pluginVersion: string;
  zccVersion: string;
}): PluginArtifactMeta {
  return {
    sdkMajor: PLUGIN_SDK_API_MAJOR,
    sdkVersion: PLUGIN_SDK_VERSION,
    artifactFormatVersion: 1,
    pluginId: derivePluginId(args.packageName),
    pluginVersion: args.pluginVersion,
    builtWith: { zccVersion: args.zccVersion, pluginSdkVersion: PLUGIN_SDK_VERSION }
  };
}

export function writePluginArtifactMeta(path: string, meta: PluginArtifactMeta): void {
  mkdirSync(dirname(path), { recursive: true });
  const staging = `${path}.tmp`;
  writeFileSync(staging, `${JSON.stringify(meta, null, 2)}\n`);
  renameSync(staging, path);
}

function readPkg(rootDir: string): { name: string; version: string; zcc?: { server?: string; app?: string } } {
  return JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
    zcc?: { server?: string; app?: string };
  };
}

async function bundle(opts: {
  entry: string;
  outfile: string;
  platform: 'node' | 'browser';
}): Promise<void> {
  const esbuild = await import('esbuild');
  const stagingDir = join(dirname(opts.outfile), `.stage-${process.pid}`);
  mkdirSync(stagingDir, { recursive: true });
  const staged = join(stagingDir, 'out.js');
  try {
    await esbuild.build({
      absWorkingDir: dirname(opts.entry),
      entryPoints: [opts.entry],
      outfile: staged,
      bundle: true,
      format: 'esm',
      platform: opts.platform,
      target: 'es2022',
      jsx: 'automatic',
      logLevel: 'silent',
      external:
        opts.platform === 'node'
          ? ['@zana-ai/zcc-plugin-sdk', '@zana-ai/zcc-plugin-sdk/server']
          : ['react', 'react-dom', '@zana-ai/zcc-plugin-sdk', '@zana-ai/zcc-plugin-sdk/app'],
      banner:
        opts.platform === 'browser'
          ? {
              js: 'const React = globalThis.__ZCC_HOST_REACT__;'
            }
          : undefined
    });
    mkdirSync(dirname(opts.outfile), { recursive: true });
    renameSync(staged, opts.outfile);
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

function resolveSource(rootDir: string, candidates: string[]): string | null {
  for (const rel of candidates) {
    const abs = join(rootDir, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}

export async function buildPluginServer(rootDir: string, zccVersion: string): Promise<{ jsPath: string; metaPath: string } | null> {
  const pkg = readPkg(rootDir);
  const entry = resolveSource(rootDir, ['server.ts', 'server.mts', 'src/server.ts']);
  if (!entry) return null;
  const jsPath = join(rootDir, 'server.mjs');
  await bundle({ entry, outfile: jsPath, platform: 'node' });
  const metaPath = join(rootDir, 'server.meta.json');
  writePluginArtifactMeta(metaPath, createPluginArtifactMeta({
    packageName: pkg.name,
    pluginVersion: pkg.version,
    zccVersion
  }));
  return { jsPath, metaPath };
}

export async function buildPluginApp(rootDir: string, zccVersion: string): Promise<{ jsPath: string; metaPath: string } | null> {
  const pkg = readPkg(rootDir);
  const entry = resolveSource(rootDir, ['app.tsx', 'app.jsx', 'app.ts', 'src/app.tsx']);
  if (!entry) return null;
  const jsPath = join(rootDir, 'app.js');
  await bundle({ entry, outfile: jsPath, platform: 'browser' });
  const metaPath = join(rootDir, 'app.meta.json');
  writePluginArtifactMeta(metaPath, createPluginArtifactMeta({
    packageName: pkg.name,
    pluginVersion: pkg.version,
    zccVersion
  }));
  return { jsPath, metaPath };
}

const FALLBACK_BUNDLED_SDK_DTS = `declare module '@zana-ai/zcc-plugin-sdk/server' {
  export interface ZccPluginApi {
    readonly pluginId: string;
    readonly log: { debug(m: string): void; info(m: string): void; warn(m: string): void; error(m: string): void };
    readonly rpc: { method(name: string, handler: (args: unknown) => unknown): void };
    onDispose(hook: () => void | Promise<void>): void;
  }
}
declare module '@zana-ai/zcc-plugin-sdk/app' {
  export function definePluginApp(setup: (app: { slots: Record<string, (registration: never) => void> }) => void): unknown;
  export function callPluginRpc(pluginId: string, method: string, args?: unknown): Promise<unknown>;
}
`;

function bundledSdkDts(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = join(here, '../../plugin-sdk/bundled-types/zcc-plugin-sdk.d.ts');
  if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  return FALLBACK_BUNDLED_SDK_DTS;
}

export async function syncPluginTypes(rootDir: string, options?: { check?: boolean }): Promise<Array<{ path: string; outcome: 'written' | 'unchanged' | 'stale' }>> {
  const dest = join(rootDir, 'types', 'zcc-plugin-sdk.d.ts');
  const next = bundledSdkDts();
  const existing = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
  if (options?.check) {
    return [{ path: 'types/zcc-plugin-sdk.d.ts', outcome: existing === next ? 'unchanged' : 'stale' }];
  }
  if (existing === next) {
    return [{ path: 'types/zcc-plugin-sdk.d.ts', outcome: 'unchanged' }];
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, next);
  return [{ path: 'types/zcc-plugin-sdk.d.ts', outcome: 'written' }];
}

export async function buildPlugin(rootDir: string, zccVersion: string): Promise<{
  server: Awaited<ReturnType<typeof buildPluginServer>>;
  app: Awaited<ReturnType<typeof buildPluginApp>>;
}> {
  await syncPluginTypes(rootDir);
  return {
    server: await buildPluginServer(rootDir, zccVersion),
    app: await buildPluginApp(rootDir, zccVersion)
  };
}
