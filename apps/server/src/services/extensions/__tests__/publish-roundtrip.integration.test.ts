import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { RegistryIndex } from '@zana-ai/zcc-extension-sdk';

/**
 * End-to-end contract test: the REAL `scripts/publish-extension.mjs` output must
 * be consumable by the REAL engine. Every other test uses a synthetic
 * `makeArchive`; this one runs the publish script as a child process and feeds
 * its emitted archive + index through both consumers:
 *   1. `installFromArchiveFile` (the "install from archive…" local path), and
 *   2. `applyRelease` (the marketplace download+sha256+stage path).
 *
 * It is the guard against publish-side / consume-side drift (sha256 base,
 * file-name rules, `{schema:1, releases}` shape) that the synthetic tests can't
 * see because they hand-build the archive on both ends.
 */

const SCRIPT = resolve(__dirname, '../../../scripts/publish-extension.mjs');
const engines = { zccApi: '>=1 <2' };

let installDir: string;
let artifactDir: string;
let outDir: string;

async function importInstaller() {
  return await import('../extension-installer.js');
}
async function importRegistry() {
  return await import('../extension-registry.js');
}

beforeEach(async () => {
  installDir = await mkdtemp(join(tmpdir(), 'cc-rt-install-'));
  artifactDir = await mkdtemp(join(tmpdir(), 'cc-rt-art-'));
  outDir = await mkdtemp(join(tmpdir(), 'cc-rt-out-'));
  process.env.ZCC_EXTENSIONS_DIR = installDir;
});
afterEach(async () => {
  delete process.env.ZCC_EXTENSIONS_DIR;
  await Promise.all([
    rm(installDir, { recursive: true, force: true }),
    rm(artifactDir, { recursive: true, force: true }),
    rm(outDir, { recursive: true, force: true })
  ]);
});

/** Lay down a built artifact dir (manifest + a renderer marker). */
async function writeArtifact(manifest: object, renderer = '// roundtrip renderer'): Promise<void> {
  await writeFile(join(artifactDir, 'extension.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(artifactDir, 'renderer.js'), renderer);
}

/** Run the publish script as a child process; return its produced index. */
function publish(args: string[] = []): RegistryIndex {
  execFileSync('node', [SCRIPT, artifactDir, '--out', outDir, ...args], {
    encoding: 'utf-8'
  });
  // index.json is written into --out by default.
  return JSON.parse(readFileSync(join(outDir, 'index.json'), 'utf-8'));
}

describe('publish → install round-trip (real script, real engine)', () => {
  it('publishes an artifact that installFromArchiveFile accepts verbatim', async () => {
    await writeArtifact({
      id: 'roundtrip',
      version: '1.0.0',
      engines,
      title: 'Round Trip',
      description: 'proves the contract',
      author: 'QA',
      icon: 'Box'
    });
    const idx = publish(['--base-url', 'https://exts.example.com']);

    // The index carries the catalog metadata read from the manifest.
    expect(idx.schema).toBe(1);
    expect(idx.releases[0]).toMatchObject({
      id: 'roundtrip',
      version: '1.0.0',
      zccApi: '>=1 <2',
      url: 'https://exts.example.com/roundtrip-1.0.0.json',
      title: 'Round Trip',
      description: 'proves the contract',
      author: 'QA',
      icon: 'Box'
    });

    // The emitted archive installs through the real local-install path.
    const archiveFile = join(outDir, 'roundtrip-1.0.0.json');
    const { installFromArchiveFile } = await importInstaller();
    const res = await installFromArchiveFile(archiveFile, { reservedIds: new Set<string>() });
    expect(res).toEqual({ ok: true, value: { id: 'roundtrip' } });
    expect(
      JSON.parse(await readFile(join(installDir, 'roundtrip', 'extension.json'), 'utf-8')).version
    ).toBe('1.0.0');
    expect(await readFile(join(installDir, 'roundtrip', 'renderer.js'), 'utf-8')).toBe(
      '// roundtrip renderer'
    );
  });

  it("publishes a sha256 the engine's applyRelease accepts (marketplace path)", async () => {
    await writeArtifact({ id: 'mkt', version: '2.0.0', engines });
    const idx = publish(['--base-url', 'https://cdn.example.com']);
    const release = idx.releases[0];

    // Sanity: the published sha256 is the lowercase hex of the archive bytes.
    const archiveBytes = await readFile(join(outDir, 'mkt-2.0.0.json'));
    expect(release.sha256).toBe(createHash('sha256').update(archiveBytes).digest('hex'));

    // Feed the published release + archive through the real download+verify+stage
    // path with a fetchBytes fake serving the script's own output.
    const { applyRelease } = await importRegistry();
    const out = await applyRelease(release, {
      fetchBytes: async (url: string) => {
        if (url !== release.url) throw new Error(`404 ${url}`);
        return new Uint8Array(archiveBytes);
      }
    });
    expect(out.status).toBe('updated');
    expect(
      JSON.parse(await readFile(join(installDir, 'mkt', 'extension.json'), 'utf-8')).version
    ).toBe('2.0.0');
  });

  it('upserts multiple versions into one index (never-downgrade keeps both)', async () => {
    await writeArtifact({ id: 'multi', version: '1.0.0', engines });
    publish(['--base-url', 'https://cdn.example.com']);
    await writeArtifact({ id: 'multi', version: '1.1.0', engines });
    const idx = publish(['--base-url', 'https://cdn.example.com']);

    const versions = idx.releases.filter((r) => r.id === 'multi').map((r) => r.version).sort();
    expect(versions).toEqual(['1.0.0', '1.1.0']);
    expect(existsSync(join(outDir, 'multi-1.0.0.json'))).toBe(true);
    expect(existsSync(join(outDir, 'multi-1.1.0.json'))).toBe(true);
  });
});

describe('publish-extension CLI contract', () => {
  /** Run the script raw; capture stdout/stderr/exit without throwing. */
  function run(args: string[]): { code: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf-8' });
      return { code: 0, stdout, stderr: '' };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  }

  it('--help and -h print usage and exit 0', () => {
    for (const flag of ['--help', '-h']) {
      const { code, stdout } = run([flag]);
      expect(code).toBe(0);
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('<extensionDir>');
    }
  });

  it('exits non-zero with a message when no artifact dir is given', () => {
    const { code, stderr } = run([]);
    expect(code).toBe(1);
    expect(stderr).toContain('missing <extensionDir>');
  });

  it('exits non-zero on an unknown flag', () => {
    const { code, stderr } = run(['some-dir', '--nope']);
    expect(code).toBe(1);
    expect(stderr).toContain('unknown flag: --nope');
  });
});
