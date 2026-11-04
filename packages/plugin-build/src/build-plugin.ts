import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, basename, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_SDK_API_MAJOR, PLUGIN_SDK_VERSION, derivePluginId } from '@zana-ai/zcc-plugin-sdk';
import { getPluginBuildToolchain, type PluginBuildToolchain } from './toolchain.js';

const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  'const require = __createRequire(import.meta.url);',
  'var __filename = __fileURLToPath(import.meta.url);',
  'var __dirname = __pathDirname(__filename);'
].join('\n');

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
  const staging = `${path}.tmp-${randomUUID()}`;
  writeFileSync(staging, `${JSON.stringify(meta, null, 2)}\n`);
  renameSync(staging, path);
}

function readPkg(rootDir: string): { name: string; version: string; zcc?: { server?: string; app?: string; host?: string } } {
  return JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
    zcc?: { server?: string; app?: string };
  };
}

function hostReactPlugin(): {
  name: string;
  setup(build: { onResolve(opts: { filter: RegExp }, fn: (args: { path: string }) => { path: string; namespace: string }): void; onLoad(opts: { filter: RegExp; namespace: string }, fn: (args: { path: string }) => { contents: string; loader: 'js' }): void }): void;
} {
  const namespace = 'zcc-host-react';
  const reactShim = `const React = globalThis.__ZCC_HOST_REACT__;
export default React;
export const Children = React.Children;
export const Component = React.Component;
export const Fragment = React.Fragment;
export const StrictMode = React.StrictMode;
export const Suspense = React.Suspense;
export const cloneElement = React.cloneElement;
export const createContext = React.createContext;
export const createElement = React.createElement;
export const createRef = React.createRef;
export const forwardRef = React.forwardRef;
export const isValidElement = React.isValidElement;
export const lazy = React.lazy;
export const memo = React.memo;
export const startTransition = React.startTransition;
export const useCallback = React.useCallback;
export const useContext = React.useContext;
export const useDebugValue = React.useDebugValue;
export const useDeferredValue = React.useDeferredValue;
export const useEffect = React.useEffect;
export const useId = React.useId;
export const useImperativeHandle = React.useImperativeHandle;
export const useInsertionEffect = React.useInsertionEffect;
export const useLayoutEffect = React.useLayoutEffect;
export const useMemo = React.useMemo;
export const useReducer = React.useReducer;
export const useRef = React.useRef;
export const useState = React.useState;
export const useSyncExternalStore = React.useSyncExternalStore;
export const useTransition = React.useTransition;
export const version = React.version;
`;
  const jsxShim = `const React = globalThis.__ZCC_HOST_REACT__;
export const Fragment = React.Fragment;
export function jsx(type, props, key) {
  return React.createElement(type, key === undefined ? props : { ...props, key });
}
export const jsxs = jsx;
export const jsxDEV = jsx;
`;
  const reactDomShim = `const ReactDOM = globalThis.__ZCC_HOST_REACT_DOM__;
if (ReactDOM == null) {
  throw new Error('host react-dom is not available');
}
export default ReactDOM;
export const createPortal = ReactDOM.createPortal;
export const flushSync = ReactDOM.flushSync;
export const hydrate = ReactDOM.hydrate;
export const render = ReactDOM.render;
export const unmountComponentAtNode = ReactDOM.unmountComponentAtNode;
export const findDOMNode = ReactDOM.findDOMNode;
export const version = ReactDOM.version;
`;
  const reactDomClientShim = `const ReactDOMClient = globalThis.__ZCC_HOST_REACT_DOM_CLIENT__;
if (ReactDOMClient == null) {
  throw new Error('host react-dom/client is not available');
}
export default ReactDOMClient;
export const createRoot = ReactDOMClient.createRoot;
export const hydrateRoot = ReactDOMClient.hydrateRoot;
`;
  return {
    name: 'zcc-host-react',
    setup(build) {
      build.onResolve({ filter: /^(react|react-dom|react-dom\/client|react\/jsx-runtime|react\/jsx-dev-runtime)$/ }, (args) => ({
        path: args.path,
        namespace
      }));
      build.onLoad({ filter: /.*/, namespace }, (args) => {
        if (args.path.startsWith('react/jsx')) return { contents: jsxShim, loader: 'js' };
        if (args.path === 'react-dom/client') return { contents: reactDomClientShim, loader: 'js' };
        if (args.path === 'react-dom') return { contents: reactDomShim, loader: 'js' };
        return { contents: reactShim, loader: 'js' };
      });
    }
  };
}

function resolvePluginSdkAppEntry(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = join(here, '../../plugin-sdk/src/app.ts');
  if (existsSync(src)) return src;
  const packaged = join(here, '../runtime/plugin-sdk-app.js');
  if (existsSync(packaged)) return packaged;
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const desktop = resources && join(resources, 'zcc-cli/runtime/plugin-sdk-app.js');
  if (desktop && existsSync(desktop)) return desktop;
  for (const depth of ['../..', '../../..']) {
    const built = join(here, depth, 'packages/cli/dist/runtime/plugin-sdk-app.js');
    if (existsSync(built)) return built;
  }
  return fileURLToPath(import.meta.resolve('@zana-ai/zcc-plugin-sdk/app'));
}

/**
 * Plugin app bundles are native ESM loaded with `import()` and no import map.
 * Bare `@zana-ai/zcc-plugin-sdk/app` specifiers throw in the renderer. Point
 * them at the SDK source so esbuild inlines the global-host shim (same idea
 * as `hostReactPlugin`). Backends can also use its pure helpers without a
 * runtime SDK install. Only the exact root and server entries come from the host.
 */
function hostPluginSdkPlugin(externalServerSdk = false): {
  name: string;
  setup(build: {
    onResolve(
      opts: { filter: RegExp },
      fn: (args: { path: string }) => { path: string; external?: boolean }
    ): void;
  }): void;
} {
  const sdkApp = resolvePluginSdkAppEntry();
  return {
    name: 'zcc-host-plugin-sdk-app',
    setup(build) {
      if (externalServerSdk) {
        build.onResolve({ filter: /^@zana-ai\/zcc-plugin-sdk(?:\/server)?$/ }, (args) => ({ path: args.path, external: true }));
      }
      build.onResolve({ filter: /^@zana-ai\/zcc-plugin-sdk\/app$/ }, () => ({ path: sdkApp }));
    }
  };
}

export interface PluginBundleOptions {
  minify?: boolean;
  sourcemap?: boolean;
  toolchain?: PluginBuildToolchain;
}

export async function bundlePluginEntry(opts: {
  entry: string;
  outfile: string;
  platform: 'node' | 'browser';
  minify?: boolean;
  sourcemap?: boolean;
  toolchain?: PluginBuildToolchain;
  bundleSdk?: boolean;
}): Promise<void> {
  const toolchain = opts.toolchain ?? await getPluginBuildToolchain();
  const esbuild = await import(toolchain.esbuild) as typeof import('esbuild');
  const stagingDir = join(dirname(opts.outfile), `.stage-${randomUUID()}`);
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
      minify: opts.minify ?? true,
      sourcemap: opts.sourcemap ?? false,
      logLevel: 'silent',
      loader: opts.platform === 'browser' ? { '.css': 'text' } : undefined,
      plugins: opts.platform === 'browser' ? [hostReactPlugin(), hostPluginSdkPlugin()]
        : opts.bundleSdk ? undefined : [hostPluginSdkPlugin(true)],
      banner: opts.platform === 'node' ? { js: NODE_ESM_REQUIRE_BANNER } : undefined,
      external:
        opts.bundleSdk ? [] : opts.platform === 'node'
          // esbuild's package externals match every subpath. Resolve the exact
          // host-provided entries above so SDK helpers are bundled as well.
          ? []
          : ['@zana-ai/zcc-plugin-sdk/server']
    });
    mkdirSync(dirname(opts.outfile), { recursive: true });
    renameSync(staged, opts.outfile);
    const stagedMap = `${staged}.map`;
    if (existsSync(stagedMap)) {
      const mapFile = `${opts.outfile}.map`;
      renameSync(stagedMap, mapFile);
      const js = readFileSync(opts.outfile, 'utf8');
      const next = js.replace(/sourceMappingURL=out\.js\.map/g, `sourceMappingURL=${basename(opts.outfile)}.map`);
      if (next !== js) writeFileSync(opts.outfile, next);
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

function resolveSource(rootDir: string, declared: string | undefined, candidates: string[]): string | null {
  if (declared !== undefined) {
    if (!declared || isAbsolute(declared)) throw new Error('plugin entry must be a relative file path');
    const root = realpathSync(rootDir);
    const source = resolve(rootDir, declared);
    if (source !== rootDir && !source.startsWith(resolve(rootDir) + sep)) throw new Error('plugin entry escapes the plugin directory');
    const canonical = realpathSync(source);
    if (canonical !== root && !canonical.startsWith(root + sep)) throw new Error('plugin entry escapes the plugin directory through a symlink');
    return canonical;
  }
  for (const rel of candidates) {
    const abs = join(rootDir, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}

export async function buildPluginServer(
  rootDir: string,
  zccVersion: string,
  options: PluginBundleOptions = {}
): Promise<{ jsPath: string; metaPath: string } | null> {
  const pkg = readPkg(rootDir);
  if (pkg.zcc && !pkg.zcc.server) return null;
  // A precompiled declaration may still have an editable TypeScript source.
  const declared = pkg.zcc?.server;
  const source = declared && /\.m?js$/.test(declared)
    ? declared.replace(/\.m?js$/, '.ts') : undefined;
  const entry = resolveSource(rootDir, source && existsSync(join(rootDir, source)) ? source : declared, ['server.ts', 'server.mts', 'src/server.ts']);
  if (!entry) return null;
  const jsPath = join(rootDir, 'server.mjs');
  // Published backends without editable siblings are already the output.
  // Rebundling them into themselves accumulates banners on every build.
  if (entry === join(realpathSync(rootDir), 'server.mjs')) return null;
  await bundlePluginEntry({
    entry,
    outfile: jsPath,
    platform: 'node',
    toolchain: options.toolchain,
    minify: options.minify ?? true,
    sourcemap: options.sourcemap ?? false
  });
  const metaPath = join(rootDir, 'server.meta.json');
  writePluginArtifactMeta(metaPath, createPluginArtifactMeta({
    packageName: pkg.name,
    pluginVersion: pkg.version,
    zccVersion
  }));
  return { jsPath, metaPath };
}

export async function buildPluginApp(
  rootDir: string,
  zccVersion: string,
  options: PluginBundleOptions = {}
): Promise<{ jsPath: string; metaPath: string } | null> {
  const pkg = readPkg(rootDir);
  if (pkg.zcc && !pkg.zcc.app) return null;
  const declared = pkg.zcc?.app;
  const source = declared && /\.js$/.test(declared)
    ? ['.tsx', '.ts', '.jsx'].map((ext) => declared.replace(/\.js$/, ext)).find((candidate) => existsSync(join(rootDir, candidate)))
    : undefined;
  const entry = resolveSource(rootDir, source ?? declared, ['app.tsx', 'app.jsx', 'app.ts', 'src/app.tsx']);
  if (!entry) return null;
  const jsPath = pkg.zcc?.app ? join(rootDir, pkg.zcc.app.replace(/\.[cm]?[jt]sx?$/, '.js')) : join(rootDir, 'app.js');
  await bundlePluginEntry({
    entry,
    outfile: jsPath,
    platform: 'browser',
    toolchain: options.toolchain,
    minify: options.minify ?? true,
    sourcemap: options.sourcemap ?? false
  });
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
  const packaged = join(here, '../runtime/zcc-plugin-sdk.d.ts');
  if (existsSync(packaged)) return readFileSync(packaged, 'utf8');
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

export async function buildPlugin(
  rootDir: string,
  zccVersion: string,
  options: PluginBundleOptions = {}
): Promise<{
  server: Awaited<ReturnType<typeof buildPluginServer>>;
  app: Awaited<ReturnType<typeof buildPluginApp>>;
  host: import('./build-plugin-host.js').PluginHostBuildResult | null;
}> {
  await syncPluginTypes(rootDir);
  const pkg = readPkg(rootDir);
  const toolchain = options.toolchain ?? await getPluginBuildToolchain();
  const buildOptions = { ...options, toolchain };
  return {
    server: await buildPluginServer(rootDir, zccVersion, buildOptions),
    app: await buildPluginApp(rootDir, zccVersion, buildOptions),
    host: pkg.zcc?.host ? await (await import('./build-plugin-host.js')).buildPluginHost(rootDir, zccVersion, toolchain) : null
  };
}
