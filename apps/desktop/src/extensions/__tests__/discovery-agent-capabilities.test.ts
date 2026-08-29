import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `skills` / `mcpServers` opt-in (docs/extension-agent-capabilities-plan.md):
 * discovery must parse the manifest's optional agent-capability contributions
 * and project them through to the renderer-safe `ExtensionManifestView`, with
 * the same drop-malformed-entry discipline as `agentPreset`/`projectTab` — one
 * bad entry never drops the whole array, and env VALUES never cross into the
 * view (only key names, for the consent screen). discovery.ts is electron-free,
 * so no electron mock is needed.
 */
let extDir: string;

async function importDiscovery() {
  return await import('../discovery.js');
}

async function writeExt(dirName: string, manifest: Record<string, unknown>): Promise<void> {
  const dir = join(extDir, dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'extension.json'), JSON.stringify(manifest), 'utf-8');
}

function base(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: 'X',
    icon: 'Box',
    engines: { zccApi: '^1.0.0' },
    entry: { renderer: 'renderer.js' },
    ...extra
  };
}

describe('discovery skills/mcpServers parsing + projection', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-ext-agentcap-'));
    process.env.ZCC_EXTENSIONS_DIR = extDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(extDir, { recursive: true, force: true });
  });

  it('carries well-formed skills through to the manifest view', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt(
      'acme.skills',
      base('acme.skills', {
        permissions: ['agent:contribute'],
        skills: [
          { path: 'skills/foo.md', slug: 'foo' },
          { path: 'skills/bar.md' }
        ]
      })
    );

    const found = await discoverExtensions();
    const skills = found.find((x) => x.id === 'acme.skills')?.manifest?.skills;
    expect(skills).toEqual([
      { path: 'skills/foo.md', slug: 'foo' },
      { path: 'skills/bar.md', slug: undefined }
    ]);
  });

  it('drops a skill entry with no path but keeps the rest of the array', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt(
      'acme.mixed',
      base('acme.mixed', {
        skills: [{ slug: 'no-path' }, { path: '' }, { path: 'ok.md' }]
      })
    );

    const found = await discoverExtensions();
    const skills = found.find((x) => x.id === 'acme.mixed')?.manifest?.skills;
    expect(skills).toEqual([{ path: 'ok.md', slug: undefined }]);
  });

  it('treats a non-array skills as absent', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt('acme.notarr', base('acme.notarr', { skills: { path: 'x.md' } }));
    await writeExt('acme.none', base('acme.none'));

    const found = await discoverExtensions();
    expect(found.find((x) => x.id === 'acme.notarr')?.manifest?.skills).toBeUndefined();
    expect(found.find((x) => x.id === 'acme.none')?.manifest?.skills).toBeUndefined();
  });

  it('carries a well-formed stdio mcpServer through, with envKeys but not values', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt(
      'acme.mcp',
      base('acme.mcp', {
        permissions: ['agent:contribute'],
        mcpServers: [
          {
            name: 'acme-tools',
            type: 'stdio',
            command: 'acme-mcp-server',
            args: ['--port', '0'],
            env: { ACME_TOKEN: 'super-secret-value' },
            alwaysOn: true
          }
        ]
      })
    );

    const found = await discoverExtensions();
    const servers = found.find((x) => x.id === 'acme.mcp')?.manifest?.mcpServers;
    expect(servers).toEqual([
      {
        name: 'acme-tools',
        type: 'stdio',
        command: 'acme-mcp-server',
        args: ['--port', '0'],
        url: undefined,
        envKeys: ['ACME_TOKEN'],
        alwaysOn: true
      }
    ]);
    // The secret value must never appear anywhere in the projected view.
    expect(JSON.stringify(servers)).not.toContain('super-secret-value');
  });

  it('carries a well-formed streamable-http mcpServer (url, no command)', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt(
      'acme.http',
      base('acme.http', {
        mcpServers: [{ name: 'acme-remote', type: 'streamable-http', url: 'https://acme.example/mcp' }]
      })
    );

    const found = await discoverExtensions();
    const servers = found.find((x) => x.id === 'acme.http')?.manifest?.mcpServers;
    expect(servers).toEqual([
      {
        name: 'acme-remote',
        type: 'streamable-http',
        command: undefined,
        args: undefined,
        url: 'https://acme.example/mcp',
        envKeys: undefined,
        alwaysOn: undefined
      }
    ]);
  });

  it('drops a stdio server with no command, and a non-stdio server with no url', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt(
      'acme.badservers',
      base('acme.badservers', {
        mcpServers: [
          { name: 'no-command', type: 'stdio' },
          { name: 'no-url', type: 'sse' },
          { name: 'ok', type: 'stdio', command: 'ok-bin' }
        ]
      })
    );

    const found = await discoverExtensions();
    const servers = found.find((x) => x.id === 'acme.badservers')?.manifest?.mcpServers;
    expect(servers).toEqual([
      {
        name: 'ok',
        type: 'stdio',
        command: 'ok-bin',
        args: undefined,
        url: undefined,
        envKeys: undefined,
        alwaysOn: undefined
      }
    ]);
  });

  it('drops a server entry missing name/type but keeps the rest of the array', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt(
      'acme.mixedservers',
      base('acme.mixedservers', {
        mcpServers: [
          { type: 'stdio', command: 'x' },
          { name: 'no-type' },
          { name: 'good', type: 'stdio', command: 'good-bin' }
        ]
      })
    );

    const found = await discoverExtensions();
    const servers = found.find((x) => x.id === 'acme.mixedservers')?.manifest?.mcpServers;
    expect(servers?.map((s) => s.name)).toEqual(['good']);
  });

  it('treats a non-array mcpServers as absent', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt('acme.notarr2', base('acme.notarr2', { mcpServers: { name: 'x' } }));

    const found = await discoverExtensions();
    expect(found.find((x) => x.id === 'acme.notarr2')?.manifest?.mcpServers).toBeUndefined();
  });
});
