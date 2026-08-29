import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HOST_ARTIFACT_MAX_BYTES } from '@zana-ai/zcc-host-daemon-contract';
import { assertHostArtifactByteLength, loadPluginHostArtifactSnapshot } from './plugin-host-artifact.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writePlugin(hostSource: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-host-artifact-'));
  tempDirs.push(dir);
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'zcc-plugin-host-artifact-fixture',
      version: '1.0.0',
      engines: { zcc: '>=1.0.0' },
      zcc: {
        name: 'Host artifact fixture',
        description: 'Packs a tiny host entry.',
        branding: { icon: 'Cpu' },
        server: './server.ts',
        host: './host.ts'
      }
    })
  );
  await writeFile(join(dir, 'server.ts'), 'export default function plugin() {}\n');
  await writeFile(join(dir, 'host.ts'), hostSource);
  return dir;
}

describe('loadPluginHostArtifactSnapshot', () => {
  it('returns null when the plugin has no host entry', async () => {
    expect(
      await loadPluginHostArtifactSnapshot({
        pluginId: 'notes',
        rootDir: '/tmp/missing',
        hostEntry: null,
        sourceKind: 'path',
        zccVersion: '1.0.0'
      })
    ).toBeNull();
  });

  it('rebuilds from source and records digest plus size', async () => {
    const dir = await writePlugin('export default { ok: true };\n');
    const snapshot = await loadPluginHostArtifactSnapshot({
      pluginId: 'host-fixture',
      rootDir: dir,
      hostEntry: './host.ts',
      sourceKind: 'path',
      zccVersion: '1.0.0'
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot!.byteLength).toBeGreaterThan(0);
    expect(snapshot!.path).toBe(join(dir, 'dist', 'host.js'));
    const meta = JSON.parse(await readFile(join(dir, 'dist', 'host.meta.json'), 'utf8')) as {
      artifactDigest: string;
    };
    expect(meta.artifactDigest).toBe(snapshot!.digest);
  });

  it('loads a packaged prebuilt dist without rebuilding missing source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-packaged-'));
    tempDirs.push(dir);
    await mkdir(join(dir, 'dist'), { recursive: true });
    const bytes = Buffer.from('export default 1;\n');
    await writeFile(join(dir, 'dist', 'host.js'), bytes);
    const digest = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    await writeFile(
      join(dir, 'dist', 'host.meta.json'),
      JSON.stringify({ artifactDigest: digest })
    );
    const snapshot = await loadPluginHostArtifactSnapshot({
      pluginId: 'provider-acp',
      rootDir: dir,
      hostEntry: './src/bridge/bridge.ts',
      sourceKind: 'builtin',
      zccVersion: '1.0.0'
    });
    expect(snapshot?.digest).toBe(digest);
    expect(snapshot?.byteLength).toBe(bytes.byteLength);
  });

  it('does not rebuild an npm-installed plugin even when source is present', async () => {
    const dir = await writePlugin('export default { rebuilt: true };\n');
    await mkdir(join(dir, 'dist'), { recursive: true });
    const bytes = Buffer.from('export default "prebuilt";\n');
    const digest = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(dir, 'dist', 'host.js'), bytes);
    await writeFile(join(dir, 'dist', 'host.meta.json'), JSON.stringify({ artifactDigest: digest }));
    const snapshot = await loadPluginHostArtifactSnapshot({
      pluginId: 'from-npm',
      rootDir: dir,
      hostEntry: './host.ts',
      sourceKind: 'npm',
      zccVersion: '1.0.0'
    });
    expect(snapshot?.digest).toBe(digest);
    expect(await readFile(join(dir, 'dist', 'host.js'), 'utf8')).toBe('export default "prebuilt";\n');
  });

  it('rejects a digest mismatch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-mismatch-'));
    tempDirs.push(dir);
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'dist', 'host.js'), 'export default 1;\n');
    await writeFile(join(dir, 'dist', 'host.meta.json'), JSON.stringify({ artifactDigest: 'ab'.repeat(32) }));
    await expect(
      loadPluginHostArtifactSnapshot({
        pluginId: 'broken',
        rootDir: dir,
        hostEntry: './src/bridge/bridge.ts',
        sourceKind: 'builtin',
        zccVersion: '1.0.0'
      })
    ).rejects.toThrow(/has digest/u);
  });

  it('rejects a missing packaged artifact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-missing-'));
    tempDirs.push(dir);
    await expect(
      loadPluginHostArtifactSnapshot({
        pluginId: 'missing',
        rootDir: dir,
        hostEntry: './src/bridge/bridge.ts',
        sourceKind: 'builtin',
        zccVersion: '1.0.0'
      })
    ).rejects.toThrow(/missing or unreadable/u);
  });

  it('rejects invalid host.meta.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-meta-'));
    tempDirs.push(dir);
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'dist', 'host.js'), 'export default 1;\n');
    await writeFile(join(dir, 'dist', 'host.meta.json'), '{not-json');
    await expect(
      loadPluginHostArtifactSnapshot({
        pluginId: 'broken-meta',
        rootDir: dir,
        hostEntry: './src/bridge/bridge.ts',
        sourceKind: 'builtin',
        zccVersion: '1.0.0'
      })
    ).rejects.toThrow(/has digest/u);
  });

  it('rejects a missing meta file beside host.js', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-nometa-'));
    tempDirs.push(dir);
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'dist', 'host.js'), 'export default 1;\n');
    await expect(
      loadPluginHostArtifactSnapshot({
        pluginId: 'nometa',
        rootDir: dir,
        hostEntry: './src/bridge/bridge.ts',
        sourceKind: 'builtin',
        zccVersion: '1.0.0'
      })
    ).rejects.toThrow(/missing or unreadable/u);
  });

  it('rejects a host.js path that is not a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-dir-'));
    tempDirs.push(dir);
    await mkdir(join(dir, 'dist', 'host.js'), { recursive: true });
    await expect(
      loadPluginHostArtifactSnapshot({
        pluginId: 'dir-artifact',
        rootDir: dir,
        hostEntry: './src/bridge/bridge.ts',
        sourceKind: 'builtin',
        zccVersion: '1.0.0'
      })
    ).rejects.toThrow(/not a file/u);
  });

  it('rejects an oversized byte length', () => {
    expect(() => assertHostArtifactByteLength('ok', 12)).not.toThrow();
    expect(() => assertHostArtifactByteLength('huge', HOST_ARTIFACT_MAX_BYTES + 1)).toThrow(/exceeds the/u);
  });
});
