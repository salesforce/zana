import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostRpcCommand } from '@zana-ai/zcc-contracts/host-rpc';
import { PluginHostCallCommandSchema } from '@zana-ai/zcc-contracts/host-rpc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginHostManager } from '../plugin-host-manager.js';
import { ProjectCatalogue } from '../project-catalogue.js';

type Call = Extract<HostRpcCommand, { type: 'plugin.host.call' }>;

// Real forked worker running a real host entry; nothing about the worker is mocked.
const artifact = Buffer.from(`
const any = { "~standard": { validate(value) { return { value }; } } };
export default {
  experimental_apiVersion: 1,
  contract: { where: { input: any, output: any } },
  handlers: { async where(_input, context) { return { projectRoot: context.experimental_paths.projectRoot }; } },
};
`);

function call(overrides: Partial<Call> = {}): Call {
  return {
    type: 'plugin.host.call', contributedEnv: [], pluginId: 'remote-root', generation: 'g1',
    artifact: { digest: createHash('sha256').update(artifact).digest('hex'), byteLength: artifact.byteLength },
    callId: randomUUID(), method: 'where', input: {}, timeoutMs: 10_000, ...overrides
  };
}

describe('plugin host worker project root on the execution host', () => {
  let base: string;
  let catalogue: ProjectCatalogue;
  let manager: PluginHostManager;
  let registered: string;
  let outside: string;

  beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'zcc-remote-root-')));
    registered = join(base, 'registered');
    outside = join(base, 'outside');
    await mkdir(join(registered, 'packages', 'app'), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'secret.txt'), 'secret');
    catalogue = new ProjectCatalogue(join(base, 'data'), undefined);
    await catalogue.register([{ path: registered }]);
    manager = new PluginHostManager({
      dataDir: join(base, 'host-data'),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      fetchArtifact: async () => artifact,
      registeredProjectRoots: () => catalogue.roots()
    });
  });

  afterEach(async () => {
    await manager.shutdown();
    await catalogue.close();
    await rm(base, { recursive: true, force: true });
  });

  it('hands the worker the realpath of a registered root', async () => {
    const result = await manager.call(call({ daemonConfinedProjectRoot: registered }));
    expect(result.output).toEqual({ projectRoot: registered });
  });

  it('accepts a folder nested in a registered root', async () => {
    const nested = join(registered, 'packages', 'app');
    expect((await manager.call(call({ daemonConfinedProjectRoot: nested }))).output).toEqual({ projectRoot: nested });
  });

  it('normalizes a symlink that stays inside the project to its real path', async () => {
    const link = join(base, 'alias');
    await symlink(registered, link);
    expect((await manager.call(call({ daemonConfinedProjectRoot: link }))).output).toEqual({ projectRoot: registered });
  });

  it('rejects a root outside every registered project', async () => {
    await expect(manager.call(call({ daemonConfinedProjectRoot: outside }))).rejects.toThrow('root-outside-project');
  });

  it('rejects dot-dot traversal out of a registered root', async () => {
    await expect(manager.call(call({ daemonConfinedProjectRoot: join(registered, '..', 'outside') }))).rejects.toThrow('root-outside-project');
  });

  it('rejects a symlink inside the project that escapes it', async () => {
    const escape = join(registered, 'escape');
    await symlink(outside, escape);
    await expect(manager.call(call({ daemonConfinedProjectRoot: escape }))).rejects.toThrow('root-outside-project');
  });

  it('rejects a sibling that only shares a name prefix with a registered root', async () => {
    const sibling = `${registered}-evil`;
    await mkdir(sibling);
    await expect(manager.call(call({ daemonConfinedProjectRoot: sibling }))).rejects.toThrow('root-outside-project');
  });

  it('rejects a root that does not exist on this host', async () => {
    await expect(manager.call(call({ daemonConfinedProjectRoot: join(registered, 'gone') }))).rejects.toThrow(/unavailable/);
  });

  it('rejects when the registered folder has vanished', async () => {
    await rm(registered, { recursive: true });
    await expect(manager.call(call({ daemonConfinedProjectRoot: registered }))).rejects.toThrow(/unavailable/);
  });

  it('rejects a relative root', async () => {
    await expect(manager.call(call({ daemonConfinedProjectRoot: 'registered' }))).rejects.toThrow(/absolute/);
  });

  it('fails closed when the host has no project registry', async () => {
    const bare = new PluginHostManager({
      dataDir: join(base, 'bare'), logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, fetchArtifact: async () => artifact
    });
    try {
      await expect(bare.call(call({ daemonConfinedProjectRoot: registered }))).rejects.toThrow(/no project registry/);
    } finally {
      await bare.shutdown();
    }
  });

  it('refuses both root fields together at the manager and the wire schema', async () => {
    await expect(manager.call(call({ projectRoot: registered, daemonConfinedProjectRoot: registered }))).rejects.toThrow(/mutually exclusive/);
    expect(PluginHostCallCommandSchema.safeParse(call({ projectRoot: registered, daemonConfinedProjectRoot: registered })).success).toBe(false);
    expect(PluginHostCallCommandSchema.safeParse(call({ daemonConfinedProjectRoot: registered })).success).toBe(true);
  });

  it('keeps a server-confined root unchanged', async () => {
    expect((await manager.call(call({ projectRoot: outside }))).output).toEqual({ projectRoot: outside });
  });
});
