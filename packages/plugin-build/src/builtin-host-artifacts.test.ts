import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPluginHost } from './build-plugin-host.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

describe('builtin host artifacts', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('builds and executes the self-contained Keep Awake artifact', async () => {
    const root = await mkdtemp(join(repositoryRoot, '.builtin-host-test-'));
    tempDirs.push(root);
    const source = join(repositoryRoot, 'plugins', 'keep-awake');
    for (const fileName of ['package.json', 'server.mjs', 'host.mjs']) {
      await cp(join(source, fileName), join(root, fileName));
    }
    const built = await buildPluginHost(root, '0.9.0-test');
    const imported: unknown = await import(`${pathToFileURL(built.jsPath).href}?test=${Date.now()}`);
    const entry = Reflect.get(Object(imported), 'default');
    expect(typeof entry).toBe('function');
    const handlers = new Map<string, (input?: unknown) => unknown>();
    await (entry as (api: { methods: { register: typeof handlers.set } }) => unknown)({
      methods: {
        register(name: string, handler: (input?: unknown) => unknown) {
          handlers.set(name, handler);
        }
      }
    });
    expect(typeof handlers.get('status')).toBe('function');
    expect(await handlers.get('status')?.()).toEqual({ awake: false });
  }, 20_000);

  it('builds the provider-acp host entry as a relocatable bridge', async () => {
    const root = await mkdtemp(join(repositoryRoot, '.builtin-host-test-'));
    tempDirs.push(root);
    const source = join(repositoryRoot, 'plugins', 'provider-acp');
    await cp(join(source, 'package.json'), join(root, 'package.json'));
    await cp(join(source, 'src'), join(root, 'src'), { recursive: true });
    await cp(join(source, 'icons'), join(root, 'icons'), { recursive: true });
    const built = await buildPluginHost(root, '0.9.0-test');
    const imported: unknown = await import(`${pathToFileURL(built.jsPath).href}?test=${Date.now()}`);
    const bridge = Reflect.get(Object(imported), 'experimental_providerBridge');
    expect(bridge).toMatchObject({ experimental_apiVersion: 1 });
    expect(typeof Reflect.get(Object(bridge), 'handleLine')).toBe('function');
  }, 90_000);

  it('leaves Pi on the daemon-bundled bridge instead of a plugin host artifact', async () => {
    const pkg = JSON.parse(
      await readFile(join(repositoryRoot, 'plugins', 'provider-pi', 'package.json'), 'utf8')
    ) as { zcc?: { host?: unknown } };
    expect(pkg.zcc?.host).toBeUndefined();
  });
});
