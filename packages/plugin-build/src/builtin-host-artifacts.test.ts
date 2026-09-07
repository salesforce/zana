import { spawn } from 'node:child_process';
import { lstat, cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPluginHost } from './build-plugin-host.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

async function runMcpProbe(command: string, args: string[], env: NodeJS.ProcessEnv, input: string): Promise<string> {
  return new Promise((resolveProbe, rejectProbe) => {
    const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', rejectProbe);
    child.once('close', (code) => {
      if (code === 0) resolveProbe(stdout);
      else rejectProbe(new Error(`MCP probe exited ${String(code)}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

async function stagePluginForHostBuild(
  source: string,
  root: string,
  extraPaths: readonly string[] = []
): Promise<void> {
  await cp(join(source, 'package.json'), join(root, 'package.json'));
  await cp(join(source, 'src'), join(root, 'src'), { recursive: true });
  for (const extra of extraPaths) {
    await cp(join(source, extra), join(root, extra), { recursive: true });
  }
  const nodeModules = join(source, 'node_modules');
  try {
    await lstat(nodeModules);
    await symlink(nodeModules, join(root, 'node_modules'));
  } catch {
    // Isolated copies still build when the plugin has no extra npm deps.
  }
}

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
          return handlers;
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
    await stagePluginForHostBuild(source, root, ['icons']);
    const built = await buildPluginHost(root, '0.9.0-test');
    const imported: unknown = await import(`${pathToFileURL(built.jsPath).href}?test=${Date.now()}`);
    const bridge = Reflect.get(Object(imported), 'experimental_providerBridge');
    expect(bridge).toMatchObject({ experimental_apiVersion: 1 });
    expect(typeof Reflect.get(Object(bridge), 'handleLine')).toBe('function');

    const stdout = await runMcpProbe(
      process.execPath,
      [built.jsPath, '--mcp-stdio'],
      {
        ...process.env,
        BB_ACP_DYNAMIC_TOOL_HOST: '127.0.0.1',
        BB_ACP_DYNAMIC_TOOL_PORT: '1',
        BB_ACP_DYNAMIC_TOOL_TOKEN: 'test-token',
        BB_ACP_DYNAMIC_TOOL_THREAD_ID: 'test-thread',
        BB_ACP_DYNAMIC_TOOLS: JSON.stringify([
          {
            name: 'execution_start',
            description: 'Start execution.',
            inputSchema: { type: 'object', properties: {} }
          }
        ])
      },
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n` +
        `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`
    );
    const replies = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id: number; result: unknown });
    expect(replies).toContainEqual(expect.objectContaining({ id: 1 }));
    expect(replies).toContainEqual({
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: [
          {
            name: 'execution_start',
            description: 'Start execution.',
            inputSchema: { type: 'object', properties: {} }
          }
        ]
      }
    });
  }, 90_000);

  it('builds the provider-claude-code host entry as a relocatable Agent SDK bridge', async () => {
    const root = await mkdtemp(join(repositoryRoot, '.builtin-host-test-'));
    tempDirs.push(root);
    const source = join(repositoryRoot, 'plugins', 'provider-claude-code');
    await stagePluginForHostBuild(source, root);
    const built = await buildPluginHost(root, '0.9.0-test');
    const imported: unknown = await import(`${pathToFileURL(built.jsPath).href}?test=${Date.now()}`);
    const bridge = Reflect.get(Object(imported), 'experimental_providerBridge');
    expect(bridge).toMatchObject({ experimental_apiVersion: 1 });
    expect(typeof Reflect.get(Object(bridge), 'handleLine')).toBe('function');
  }, 90_000);

  it('builds the provider-codex host entry as a relocatable app-server bridge', async () => {
    const root = await mkdtemp(join(repositoryRoot, '.builtin-host-test-'));
    tempDirs.push(root);
    const source = join(repositoryRoot, 'plugins', 'provider-codex');
    await stagePluginForHostBuild(source, root);
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
