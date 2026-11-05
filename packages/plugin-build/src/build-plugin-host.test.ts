import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPluginHost, isPublishedHostArtifact } from './build-plugin-host.js';

describe('plugin host build', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('resolves the plugin SDK from source so packaging does not need dist/', async () => {
    const source = await readFile(new URL('./build-plugin-host.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/conditions:\s*\[\s*'source'\s*\]/);
  });

  it('builds a self-contained Node artifact with identity and digest metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-build-test-'));
    tempDirs.push(dir);
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'zcc-plugin-host-build-fixture',
        version: '1.2.3',
        engines: { zcc: '>=1.0.0' },
        zcc: {
          name: 'Host fixture',
          description: 'Exercises the host artifact builder.',
          branding: { icon: 'Cpu' },
          server: './server.ts',
          host: './host.ts'
        }
      })
    );
    await writeFile(join(dir, 'server.ts'), 'export default function plugin() {}\n');
    await writeFile(
      join(dir, 'host.ts'),
      [
        'import { experimental_defineHostEntry } from "@zana-ai/zcc-plugin-sdk";',
        'export default experimental_defineHostEntry((api) => {',
        '  api.methods.register("echo", (input) => input);',
        '});',
        ''
      ].join('\n')
    );

    const result = await buildPluginHost(dir, '0.9.0-test');
    const bytes = await readFile(result.jsPath);
    const bundle = bytes.toString('utf8');
    const metadata = JSON.parse(await readFile(result.metaPath, 'utf8')) as {
      pluginId: string;
      pluginVersion: string;
      builtWith: { zccVersion: string };
      artifactDigest: string;
    };

    expect(bundle).not.toMatch(/from\s+["']@zana-ai\/zcc-plugin-sdk/u);
    expect(metadata).toMatchObject({
      pluginId: 'host-build-fixture',
      pluginVersion: '1.2.3',
      builtWith: { zccVersion: '0.9.0-test' },
      artifactDigest: result.artifactDigest
    });
    expect(result.artifactDigest).toBe(createHash('sha256').update(bytes).digest('hex'));

    const builtEntry = (await import(result.jsPath)) as {
      default: { __zccPluginHost: true; setup: (api: { methods: { register: Function } }) => void };
    };
    expect(builtEntry.default.__zccPluginHost).toBe(true);
    const handlers = new Map<string, (input: unknown) => unknown>();
    builtEntry.default.setup({
      methods: {
        register(name: string, handler: (input: unknown) => unknown) {
          handlers.set(name, handler);
        }
      }
    });
    expect(handlers.get('echo')?.('from-artifact')).toBe('from-artifact');
  });

  it('removes old host staging directories without deleting an active concurrent build', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-stage-cleanup-test-'));
    tempDirs.push(dir);
    const distDir = join(dir, 'dist');
    await mkdir(join(distDir, '.host-stage-abandoned'), { recursive: true });
    await writeFile(join(distDir, '.host-stage-abandoned', 'partial-host.js'), 'partial artifact\n');
    const abandonedAt = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await utimes(join(distDir, '.host-stage-abandoned'), abandonedAt, abandonedAt);
    await mkdir(join(distDir, '.host-stage-active'));
    await writeFile(join(distDir, '.host-stage-active', 'partial-host.js'), 'active build artifact\n');
    await mkdir(join(distDir, '.stage-app-build'));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'zcc-plugin-host-stage-cleanup-fixture',
        version: '1.0.0',
        engines: { zcc: '>=1.0.0' },
        zcc: {
          name: 'Host stage cleanup fixture',
          description: 'Exercises stale host staging directory cleanup.',
          branding: { icon: 'Cpu' },
          server: './server.ts',
          host: './host.ts'
        }
      })
    );
    await writeFile(join(dir, 'server.ts'), 'export default function plugin() {}\n');
    await writeFile(join(dir, 'host.ts'), 'export default {};\n');

    await buildPluginHost(dir, '0.9.0-test');

    const distEntries = await readdir(distDir);
    expect(distEntries).not.toContain('.host-stage-abandoned');
    expect(distEntries).toContain('.host-stage-active');
    expect(distEntries).toContain('.stage-app-build');
    expect(
      distEntries.filter((entry) => entry.startsWith('.host-stage-') && entry !== '.host-stage-active')
    ).toEqual([]);
  });

  it.each([false, true])('builds schema host entries with optional signals/disposal (installed SDK: %s)', async installed => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-schema-test-'));
    tempDirs.push(dir);
    await writeFile(join(dir, 'package.json'), JSON.stringify({
      name: 'zcc-plugin-schema-fixture', version: '1.0.0', type: 'module',
      zcc: { host: './host.ts' }
    }));
    if (installed) {
      await mkdir(join(dir, 'node_modules/@zana-ai'), { recursive: true });
      await symlink(fileURLToPath(new URL('../../plugin-sdk', import.meta.url)), join(dir, 'node_modules/@zana-ai/zcc-plugin-sdk'));
    }
    await writeFile(join(dir, 'host.ts'), `
      import { defineRpcContract, experimental_defineHostEntry${installed ? ', experimental_nativeRootsResolveInputSchema' : ''} } from '@zana-ai/zcc-plugin-sdk/host';
      const schema = { '~standard': { validate: value => ({ value }) } };
      const contract = defineRpcContract({ echo: { input: schema, output: schema } });
      export const minimal = experimental_defineHostEntry({ contract, handlers: { echo: value => value } });
      export let disposed = false;
      export default experimental_defineHostEntry({ contract,
        handlers: { echo: value => ${installed ? 'experimental_nativeRootsResolveInputSchema.parse(value)' : 'value'} },
        experimental_signals: { changed: { payload: schema } }, dispose() { disposed = true; }
      });
    `);
    const result = await buildPluginHost(dir, 'test');
    const module = await import(result.jsPath);
    expect(module.minimal).toMatchObject({ experimental_apiVersion: 1 });
    expect(module.minimal).not.toHaveProperty('dispose');
    expect(module.minimal).not.toHaveProperty('experimental_signals');
    expect(module.default).toMatchObject({ experimental_apiVersion: 1, experimental_signals: { changed: { payload: expect.any(Object) } } });
    const value = { providerId: 'fixture', cwd: null };
    expect(module.default.handlers.echo(value)).toEqual(value);
    if (installed) expect(() => module.default.handlers.echo({ providerId: '' })).toThrow();
    expect(module.disposed).toBe(false); module.default.dispose(); expect(module.disposed).toBe(true);
  });

  it('rejects a host entry outside the plugin directory', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.host-build-escape-test-'));
    tempDirs.push(dir);
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'zcc-plugin-host-escape-fixture',
        version: '1.0.0',
        engines: { zcc: '>=1.0.0' },
        zcc: {
          name: 'Escape fixture',
          description: 'Invalid host path.',
          branding: { icon: 'Cpu' },
          server: './server.ts',
          host: '../host.ts'
        }
      })
    );
    await writeFile(join(dir, 'server.ts'), 'export default function plugin() {}\n');

    await expect(buildPluginHost(dir, '0.9.0-test')).rejects.toThrow(/escapes the plugin directory/u);
  });

  it('rejects private ZCC workspace imports from host entries', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.host-build-private-test-'));
    tempDirs.push(dir);
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'zcc-plugin-host-private-fixture',
        version: '1.0.0',
        engines: { zcc: '>=1.0.0' },
        zcc: {
          name: 'Private import fixture',
          description: 'Invalid host dependency.',
          branding: { icon: 'Cpu' },
          server: './server.ts',
          host: './host.ts'
        }
      })
    );
    await writeFile(join(dir, 'server.ts'), 'export default function plugin() {}\n');
    await writeFile(join(dir, 'host.ts'), 'import value from "./helper.js";\nexport default value;\n');
    await writeFile(
      join(dir, 'helper.ts'),
      'import type { JsonValue } from "@zana-ai/zcc-domain";\nexport default function helper(value: JsonValue) { return value; }\n'
    );

    await expect(buildPluginHost(dir, '0.9.0-test')).rejects.toThrow(
      /cannot import private ZCC workspace package/u
    );
  });

  it('bundles the published bridge surface without stubbing it', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.host-build-bridge-test-'));
    tempDirs.push(dir);
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'zcc-plugin-host-bridge-fixture',
        version: '1.0.0',
        engines: { zcc: '>=1.0.0' },
        zcc: {
          name: 'Bridge surface fixture',
          description: 'Imports the published bridge surface.',
          branding: { icon: 'Cpu' },
          server: './server.ts',
          host: './host.ts'
        }
      })
    );
    await writeFile(join(dir, 'server.ts'), 'export default function plugin() {}\n');
    await writeFile(
      join(dir, 'host.ts'),
      [
        'import { experimental_defineProviderBridge } from "@zana-ai/zcc-plugin-sdk/provider-bridge";',
        'export const experimental_providerBridge = experimental_defineProviderBridge({',
        '  handleLine() {},',
        '});',
        'export default {};'
      ].join('\n')
    );
    const result = await buildPluginHost(dir, '0.9.0-test');
    const bundle = await readFile(result.jsPath, 'utf8');
    expect(bundle).not.toMatch(/from\s*"@zana-ai\/zcc-/u);
    expect(bundle).toContain('experimental_apiVersion');
    const imported = (await import(result.jsPath)) as {
      experimental_providerBridge: { experimental_apiVersion: number; handleLine: (line: string) => void };
    };
    expect(imported.experimental_providerBridge.experimental_apiVersion).toBe(1);
    expect(typeof imported.experimental_providerBridge.handleLine).toBe('function');
  });

  it('rejects relative type imports into private ZCC workspace packages', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'zcc-host-relative-private-'));
    tempDirs.push(parent);
    const dir = join(parent, 'plugin');
    const privatePackage = join(parent, 'private-package');
    await mkdir(dir, { recursive: true });
    await mkdir(privatePackage, { recursive: true });
    await writeFile(
      join(privatePackage, 'package.json'),
      JSON.stringify({ name: '@zana-ai/zcc-private-fixture', type: 'module' })
    );
    await writeFile(join(privatePackage, 'index.ts'), 'export type PrivateValue = string;\n');
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'zcc-plugin-relative-private-fixture',
        version: '1.0.0',
        engines: { zcc: '>=1.0.0' },
        zcc: {
          name: 'Relative private import fixture',
          description: 'Invalid relative host dependency.',
          branding: { icon: 'Cpu' },
          server: './server.ts',
          host: './host.ts'
        }
      })
    );
    await writeFile(join(dir, 'server.ts'), 'export default function plugin() {}\n');
    await writeFile(
      join(dir, 'host.ts'),
      'import type { PrivateValue } from "../private-package/index.js";\nconst value: PrivateValue = "nope";\nexport default value;\n'
    );

    await expect(buildPluginHost(dir, '0.9.0-test')).rejects.toThrow(/@zana-ai\/zcc-private-fixture/u);
  });

  it('allows private package names in comments and diagnostic strings', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.host-build-prose-test-'));
    tempDirs.push(dir);
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'zcc-plugin-host-prose-fixture',
        version: '1.0.0',
        engines: { zcc: '>=1.0.0' },
        zcc: {
          name: 'Prose fixture',
          description: 'Valid host source.',
          branding: { icon: 'Cpu' },
          server: './server.ts',
          host: './host.ts'
        }
      })
    );
    await writeFile(join(dir, 'server.ts'), 'export default function plugin() {}\n');
    await writeFile(
      join(dir, 'host.ts'),
      '// Do not import from "@zana-ai/zcc-domain".\nexport default "import type X from \'@zana-ai/zcc-domain\'";\n'
    );

    await expect(buildPluginHost(dir, '0.9.0-test')).resolves.toMatchObject({
      artifactDigest: expect.any(String)
    });
  });

  it('does not rebuild a published dist/host.js into itself', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-published-'));
    tempDirs.push(dir);
    const shipped = [
      'import { createRequire as __createRequire } from "node:module";',
      'import { dirname as __pathDirname } from "node:path";',
      'import { fileURLToPath as __fileURLToPath } from "node:url";',
      'const require = __createRequire(import.meta.url);',
      'var __filename = __fileURLToPath(import.meta.url);',
      'var __dirname = __pathDirname(__filename);',
      'export default { shipped: true };',
      ''
    ].join('\n');
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'dist', 'host.js'), shipped);
    await writeFile(join(dir, 'dist', 'host.meta.json'), '{"artifactDigest":"stale"}\n');
    await writeFile(join(dir, 'package.json'), JSON.stringify({
      name: 'zcc-plugin-published-host',
      version: '1.0.0',
      zcc: { host: './dist/host.js' }
    }));

    const result = await buildPluginHost(dir, '0.9.0-test');
    await buildPluginHost(dir, '0.9.0-test');

    const bytes = await readFile(join(dir, 'dist', 'host.js'), 'utf8');
    expect(bytes).toBe(shipped);
    expect(bytes.match(/createRequire as __createRequire/gu)).toHaveLength(1);
    expect(await readFile(join(dir, 'dist', 'host.meta.json'), 'utf8')).toBe('{"artifactDigest":"stale"}\n');
    expect(result.artifactDigest).toBe(createHash('sha256').update(shipped).digest('hex'));
    expect(await readdir(join(dir, 'dist'))).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/^\.host-stage-/u)
    ]));
  });

  it('treats a symlink to dist/host.js as the published artifact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-published-link-'));
    tempDirs.push(dir);
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'dist', 'host.js'), 'export default { shipped: true };\n');
    await symlink(join(dir, 'dist', 'host.js'), join(dir, 'linked-host.js'));
    expect(isPublishedHostArtifact(dir, './linked-host.js')).toBe(true);
    expect(isPublishedHostArtifact(dir, './dist/host.js')).toBe(true);
    expect(isPublishedHostArtifact(dir, './host.ts')).toBe(false);
  });
});
