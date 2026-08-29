import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RegistryIndex, RegistryRelease } from '@zana-ai/zcc-extension-sdk';

let installDir: string;

async function importRegistry() {
  return await import('./extension-registry.js');
}

/** Build a JSON file-bundle archive (the engine's dependency-free format). */
function makeArchive(manifest: object, extraFiles: Record<string, string> = {}): Uint8Array {
  const files: Record<string, string> = {
    'extension.json': Buffer.from(JSON.stringify(manifest)).toString('base64'),
    'renderer.js': Buffer.from('// bundled').toString('base64'),
    ...Object.fromEntries(
      Object.entries(extraFiles).map(([k, v]) => [k, Buffer.from(v).toString('base64')])
    )
  };
  return new Uint8Array(Buffer.from(JSON.stringify({ files })));
}

function sha256Hex(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex');
}

/** A fetchBytes fake serving a fixed url→bytes map. */
function fakeFetch(map: Record<string, Uint8Array>) {
  return async (url: string, maxBytes: number): Promise<Uint8Array> => {
    const b = map[url];
    if (!b) throw new Error(`404 ${url}`);
    if (b.byteLength > maxBytes) throw new Error('over cap');
    return b;
  };
}

const REG = 'https://registry.example.com/index.json';
const engines = { zccApi: '>=1 <2' };

async function writeInstalled(id: string, manifest: object, marker = 'OLD') {
  const dir = join(installDir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'extension.json'), JSON.stringify(manifest));
  await writeFile(join(dir, 'renderer.js'), marker);
}

function index(releases: RegistryRelease[]): Uint8Array {
  const idx: RegistryIndex = { schema: 1, releases };
  return new Uint8Array(Buffer.from(JSON.stringify(idx)));
}

beforeEach(async () => {
  installDir = await mkdtemp(join(tmpdir(), 'cc-reg-'));
  process.env.ZCC_EXTENSIONS_DIR = installDir;
});
afterEach(async () => {
  delete process.env.ZCC_EXTENSIONS_DIR;
  await rm(installDir, { recursive: true, force: true });
});

describe('checkAndApplyUpdates', () => {
  it('updates an installed extension to a newer compatible release', async () => {
    await writeInstalled('gus', { id: 'gus', version: '0.1.0', ...{ engines } });
    const archive = makeArchive({ id: 'gus', version: '0.2.0', engines: engines.zccApi ? engines : engines });
    const url = 'https://cdn.example.com/gus-0.2.0.json';
    const release: RegistryRelease = {
      id: 'gus',
      version: '0.2.0',
      zccApi: '>=1 <2',
      url,
      sha256: sha256Hex(archive)
    };
    const { checkAndApplyUpdates } = await importRegistry();

    const out = await checkAndApplyUpdates(REG, ['gus'], {
      fetchBytes: fakeFetch({ [REG]: index([release]), [url]: archive })
    });

    expect(out).toEqual([
      { id: 'gus', status: 'updated', fromVersion: '0.1.0', toVersion: '0.2.0' }
    ]);
    const m = JSON.parse(await readFile(join(installDir, 'gus', 'extension.json'), 'utf-8'));
    expect(m.version).toBe('0.2.0');
  });

  it('rejects a release whose bytes do not match the advertised sha256', async () => {
    await writeInstalled('gus', { id: 'gus', version: '0.1.0' });
    const archive = makeArchive({ id: 'gus', version: '0.2.0' });
    const url = 'https://cdn.example.com/gus.json';
    const release: RegistryRelease = {
      id: 'gus',
      version: '0.2.0',
      zccApi: '>=1 <2',
      url,
      sha256: 'deadbeef' // wrong
    };
    const { checkAndApplyUpdates } = await importRegistry();
    const out = await checkAndApplyUpdates(REG, ['gus'], {
      fetchBytes: fakeFetch({ [REG]: index([release]), [url]: archive })
    });

    expect(out[0].status).toBe('error');
    expect(out[0].error).toMatch(/sha256 mismatch/);
    // Install untouched.
    expect(JSON.parse(await readFile(join(installDir, 'gus', 'extension.json'), 'utf-8')).version).toBe('0.1.0');
  });

  it('never downgrades or re-applies an equal version', async () => {
    await writeInstalled('gus', { id: 'gus', version: '0.3.0' }, 'KEEP');
    const archive = makeArchive({ id: 'gus', version: '0.2.0' });
    const url = 'https://cdn.example.com/gus.json';
    const { checkAndApplyUpdates } = await importRegistry();
    const out = await checkAndApplyUpdates(REG, ['gus'], {
      fetchBytes: fakeFetch({
        [REG]: index([{ id: 'gus', version: '0.2.0', zccApi: '>=1 <2', url, sha256: sha256Hex(archive) }]),
        [url]: archive
      })
    });
    expect(out[0].status).toBe('skipped');
    expect(await readFile(join(installDir, 'gus', 'renderer.js'), 'utf-8')).toBe('KEEP');
  });

  it('holds back a release that widens permissions (needs-consent)', async () => {
    await writeInstalled('gus', { id: 'gus', version: '0.1.0', permissions: ['storage'] });
    const archive = makeArchive({ id: 'gus', version: '0.2.0', permissions: ['storage', 'exec'] });
    const url = 'https://cdn.example.com/gus.json';
    const { checkAndApplyUpdates } = await importRegistry();
    const out = await checkAndApplyUpdates(REG, ['gus'], {
      fetchBytes: fakeFetch({
        [REG]: index([
          {
            id: 'gus',
            version: '0.2.0',
            zccApi: '>=1 <2',
            url,
            sha256: sha256Hex(archive),
            permissions: ['storage', 'exec']
          }
        ]),
        [url]: archive
      })
    });
    expect(out[0].status).toBe('needs-consent');
    expect(out[0].addedPermissions).toEqual(['exec']);
    // Not applied.
    expect(JSON.parse(await readFile(join(installDir, 'gus', 'extension.json'), 'utf-8')).version).toBe('0.1.0');
  });

  it('installs a fresh release that declares permissions (no prior grant to widen)', async () => {
    // Nothing installed for "fresh" → its declared permissions are NOT a
    // "widening"; applyRelease stages it and the post-install consent flow gates
    // execution. (A widening only applies to an UPDATE of an existing install.)
    const archive = makeArchive({ id: 'fresh', version: '1.0.0', permissions: ['storage', 'exec'] });
    const url = 'https://cdn.example.com/fresh.json';
    const { checkAndApplyUpdates } = await importRegistry();
    const out = await checkAndApplyUpdates(REG, ['fresh'], {
      fetchBytes: fakeFetch({
        [REG]: index([
          {
            id: 'fresh',
            version: '1.0.0',
            zccApi: '>=1 <2',
            url,
            sha256: sha256Hex(archive),
            permissions: ['storage', 'exec']
          }
        ]),
        [url]: archive
      })
    });
    expect(out[0].status).toBe('updated');
    expect(JSON.parse(await readFile(join(installDir, 'fresh', 'extension.json'), 'utf-8')).version).toBe('1.0.0');
  });

  it('skips an API-incompatible release', async () => {
    await writeInstalled('gus', { id: 'gus', version: '0.1.0' });
    const archive = makeArchive({ id: 'gus', version: '9.0.0' });
    const url = 'https://cdn.example.com/gus.json';
    const { checkAndApplyUpdates } = await importRegistry();
    const out = await checkAndApplyUpdates(REG, ['gus'], {
      fetchBytes: fakeFetch({
        [REG]: index([{ id: 'gus', version: '9.0.0', zccApi: '>=2', url, sha256: sha256Hex(archive) }]),
        [url]: archive
      })
    });
    expect(out[0].status).toBe('skipped');
  });

  it('verifies a valid Ed25519 signature and rejects a bad one', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pub = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    await writeInstalled('gus', { id: 'gus', version: '0.1.0' });

    const archive = makeArchive({ id: 'gus', version: '0.2.0' });
    const goodSig = cryptoSign(null, archive, privateKey).toString('base64');
    const url = 'https://cdn.example.com/gus.json';
    const { checkAndApplyUpdates, makeEd25519Verifier } = await importRegistry();

    // Valid signature → applied.
    const ok = await checkAndApplyUpdates(REG, ['gus'], {
      fetchBytes: fakeFetch({
        [REG]: index([{ id: 'gus', version: '0.2.0', zccApi: '>=1 <2', url, sha256: sha256Hex(archive), signature: goodSig }]),
        [url]: archive
      }),
      verifySignature: makeEd25519Verifier(pub),
      requireSignature: true
    });
    expect(ok[0].status).toBe('updated');

    // Tampered signature → rejected (fresh install dir).
    await rm(join(installDir, 'gus'), { recursive: true, force: true });
    await writeInstalled('gus', { id: 'gus', version: '0.1.0' });
    const bad = await checkAndApplyUpdates(REG, ['gus'], {
      fetchBytes: fakeFetch({
        [REG]: index([{ id: 'gus', version: '0.2.0', zccApi: '>=1 <2', url, sha256: sha256Hex(archive), signature: 'AAAA' }]),
        [url]: archive
      }),
      verifySignature: makeEd25519Verifier(pub),
      requireSignature: true
    });
    expect(bad[0].status).toBe('error');
    expect(bad[0].error).toMatch(/signature/i);
  });

  it('rejects an unsigned release when signatures are required', async () => {
    await writeInstalled('gus', { id: 'gus', version: '0.1.0' });
    const archive = makeArchive({ id: 'gus', version: '0.2.0' });
    const url = 'https://cdn.example.com/gus.json';
    const { checkAndApplyUpdates } = await importRegistry();
    const out = await checkAndApplyUpdates(REG, ['gus'], {
      fetchBytes: fakeFetch({
        [REG]: index([{ id: 'gus', version: '0.2.0', zccApi: '>=1 <2', url, sha256: sha256Hex(archive) }]),
        [url]: archive
      }),
      verifySignature: () => true,
      requireSignature: true
    });
    expect(out[0].status).toBe('error');
    expect(out[0].error).toMatch(/unsigned/i);
  });

  it('rejects an archive with a path-escaping file name', async () => {
    await writeInstalled('gus', { id: 'gus', version: '0.1.0' });
    // Hand-build an archive with an evil name (makeArchive guards names, so inline).
    const files = {
      'extension.json': Buffer.from(JSON.stringify({ id: 'gus', version: '0.2.0' })).toString('base64'),
      '../evil.js': Buffer.from('pwned').toString('base64')
    };
    const archive = new Uint8Array(Buffer.from(JSON.stringify({ files })));
    const url = 'https://cdn.example.com/gus.json';
    const { checkAndApplyUpdates } = await importRegistry();
    const out = await checkAndApplyUpdates(REG, ['gus'], {
      fetchBytes: fakeFetch({
        [REG]: index([{ id: 'gus', version: '0.2.0', zccApi: '>=1 <2', url, sha256: sha256Hex(archive) }]),
        [url]: archive
      })
    });
    expect(out[0].status).toBe('error');
    expect(out[0].error).toMatch(/path escape/);
    expect(existsSync(join(installDir, 'evil.js'))).toBe(false);
  });

  it('returns all-error (never throws) when the index fetch fails', async () => {
    const { checkAndApplyUpdates } = await importRegistry();
    const out = await checkAndApplyUpdates(REG, ['gus', 'cu'], {
      fetchBytes: async () => {
        throw new Error('network down');
      }
    });
    expect(out.map((o) => o.status)).toEqual(['error', 'error']);
  });

  it('rejects a non-HTTPS registry URL', async () => {
    const { fetchRegistryIndex } = await importRegistry();
    await expect(
      fetchRegistryIndex('http://insecure.example.com/index.json', {
        fetchBytes: async () => new Uint8Array()
      })
    ).rejects.toThrow(/HTTPS/);
  });
});

describe('maybeCheckRemoteUpdates (opt-in config)', () => {
  let cfgFile: string;
  beforeEach(() => {
    cfgFile = join(installDir, 'extension-registry.json');
    process.env.ZCC_EXTENSION_REGISTRY_CONFIG = cfgFile;
  });
  afterEach(() => {
    delete process.env.ZCC_EXTENSION_REGISTRY_CONFIG;
    delete process.env.ZCC_EXTENSION_REGISTRY_URL;
  });

  it('is a no-op when no config file exists', async () => {
    const { maybeCheckRemoteUpdates } = await importRegistry();
    expect(await maybeCheckRemoteUpdates(['gus'])).toEqual([]);
  });

  it('is a no-op when config exists but enabled is not true', async () => {
    await writeFile(cfgFile, JSON.stringify({ enabled: false, registryUrl: 'https://r/index.json' }));
    const { maybeCheckRemoteUpdates } = await importRegistry();
    expect(await maybeCheckRemoteUpdates(['gus'])).toEqual([]);
  });

  it('is a no-op when the configured registryUrl is not HTTPS', async () => {
    await writeFile(cfgFile, JSON.stringify({ enabled: true, registryUrl: 'http://r/index.json' }));
    const { maybeCheckRemoteUpdates } = await importRegistry();
    expect(await maybeCheckRemoteUpdates(['gus'])).toEqual([]);
  });

  it('reads a valid enabled config (parses registryUrl)', async () => {
    await writeFile(cfgFile, JSON.stringify({ enabled: true, registryUrl: 'https://r/index.json' }));
    const { readRegistryConfig } = await importRegistry();
    const cfg = await readRegistryConfig();
    expect(cfg?.registryUrl).toBe('https://r/index.json');
  });

  it('falls back to ZCC_EXTENSION_REGISTRY_URL when the file opts in but omits a URL', async () => {
    process.env.ZCC_EXTENSION_REGISTRY_URL = 'https://cdn.example.com/extensions/index.json';
    await writeFile(cfgFile, JSON.stringify({ enabled: true }));
    const { readRegistryConfig } = await importRegistry();
    const cfg = await readRegistryConfig();
    expect(cfg?.registryUrl).toBe('https://cdn.example.com/extensions/index.json');
  });

  it('lets an explicit file registryUrl win over the env default', async () => {
    process.env.ZCC_EXTENSION_REGISTRY_URL = 'https://cdn.example.com/extensions/index.json';
    await writeFile(cfgFile, JSON.stringify({ enabled: true, registryUrl: 'https://file/index.json' }));
    const { readRegistryConfig } = await importRegistry();
    const cfg = await readRegistryConfig();
    expect(cfg?.registryUrl).toBe('https://file/index.json');
  });

  it('does NOT enable the channel from the env URL alone (opt-in invariant)', async () => {
    // No config file on disk -> the env default must not make the channel reach out.
    process.env.ZCC_EXTENSION_REGISTRY_URL = 'https://cdn.example.com/extensions/index.json';
    const { readRegistryConfig } = await importRegistry();
    expect(await readRegistryConfig()).toBeNull();
  });

  it('ignores a non-HTTPS env URL', async () => {
    process.env.ZCC_EXTENSION_REGISTRY_URL = 'http://cdn.example.com/extensions/index.json';
    await writeFile(cfgFile, JSON.stringify({ enabled: true }));
    const { readRegistryConfig } = await importRegistry();
    expect(await readRegistryConfig()).toBeNull();
  });
});

describe('listMarketplace', () => {
  const deps = (map: Record<string, Uint8Array>) => ({ fetchBytes: fakeFetch(map) });

  it('is a no-op ([]) when no registry is configured', async () => {
    const { listMarketplace } = await importRegistry();
    expect(await listMarketplace(['gus'])).toEqual([]);
  });

  it('maps installed / hasUpdate / compatible and carries catalog metadata', async () => {
    // alpha: installed older → hasUpdate. beta: not installed. legacy: incompatible.
    await writeInstalled('alpha', { id: 'alpha', version: '1.0.0' });
    const releases: RegistryRelease[] = [
      {
        id: 'alpha',
        version: '1.2.0',
        zccApi: '>=1 <2',
        url: 'https://cdn/alpha.json',
        sha256: 'x',
        title: 'Alpha',
        description: 'The first one',
        author: 'Team A',
        icon: 'Sparkles',
        permissions: ['storage']
      },
      {
        id: 'beta',
        version: '0.1.0',
        zccApi: '>=1 <2',
        url: 'https://cdn/beta.json',
        sha256: 'y'
      },
      {
        id: 'legacy',
        version: '9.0.0',
        zccApi: '>=2',
        url: 'https://cdn/legacy.json',
        sha256: 'z',
        title: 'Legacy'
      }
    ];
    const { listMarketplace } = await importRegistry();
    const out = await listMarketplace(['alpha'], undefined, {
      registryUrl: REG,
      deps: deps({ [REG]: index(releases) })
    });

    const byId = Object.fromEntries(out.map((e) => [e.id, e]));
    expect(byId.alpha).toMatchObject({
      version: '1.2.0',
      title: 'Alpha',
      description: 'The first one',
      author: 'Team A',
      icon: 'Sparkles',
      permissions: ['storage'],
      installed: true,
      installedVersion: '1.0.0',
      hasUpdate: true,
      compatible: true
    });
    expect(byId.beta).toMatchObject({
      title: 'beta', // falls back to id when no catalog title
      installed: false,
      hasUpdate: false,
      compatible: true
    });
    expect(byId.legacy).toMatchObject({ installed: false, compatible: false });
  });

  it('returns [] (never throws) when the index fetch fails', async () => {
    const { listMarketplace } = await importRegistry();
    const out = await listMarketplace(['gus'], undefined, {
      registryUrl: REG,
      deps: {
        fetchBytes: async () => {
          throw new Error('network down');
        }
      }
    });
    expect(out).toEqual([]);
  });

  it('stamps source:marketplace on remote rows', async () => {
    const releases: RegistryRelease[] = [
      { id: 'alpha', version: '1.0.0', zccApi: '>=1 <2', url: 'https://cdn/a.json', sha256: 'x' }
    ];
    const { listMarketplace } = await importRegistry();
    const out = await listMarketplace([], undefined, {
      registryUrl: REG,
      deps: deps({ [REG]: index(releases) })
    });
    expect(out[0]).toMatchObject({ id: 'alpha', source: 'marketplace' });
  });

  it('surfaces the bundled catalog even with no remote registry configured', async () => {
    const { listMarketplace } = await importRegistry();
    const out = await listMarketplace([], undefined, undefined, [
      {
        id: 'gus',
        version: '0.2.1',
        apiRange: '^1.0.0',
        title: 'GUS',
        icon: 'Ticket',
        permissions: ['exec']
      }
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'gus',
      version: '0.2.1',
      title: 'GUS',
      icon: 'Ticket',
      permissions: ['exec'],
      hasUpdate: false,
      compatible: true,
      source: 'bundled'
    });
  });

  it('marks a bundled row installed when it exists on disk', async () => {
    await writeInstalled('gus', { id: 'gus', version: '0.2.1' });
    const { listMarketplace } = await importRegistry();
    const out = await listMarketplace(['gus'], undefined, undefined, [
      { id: 'gus', version: '0.2.1', apiRange: '^1.0.0', title: 'GUS', permissions: [] }
    ]);
    expect(out[0]).toMatchObject({ installed: true, installedVersion: '0.2.1', source: 'bundled' });
  });

  it('flags a bundled row incompatible when its apiRange does not satisfy the host', async () => {
    const { listMarketplace } = await importRegistry();
    const out = await listMarketplace([], undefined, undefined, [
      { id: 'future', version: '9.0.0', apiRange: '>=2', title: 'Future', permissions: [] }
    ]);
    expect(out[0]).toMatchObject({ id: 'future', compatible: false, source: 'bundled' });
  });

  it('lets a remote release override its bundled twin (remote wins, one row)', async () => {
    const releases: RegistryRelease[] = [
      {
        id: 'gus',
        version: '0.3.0',
        zccApi: '>=1 <2',
        url: 'https://cdn/gus.json',
        sha256: 'x',
        title: 'GUS (registry)'
      }
    ];
    const { listMarketplace } = await importRegistry();
    const out = await listMarketplace([], undefined, {
      registryUrl: REG,
      deps: deps({ [REG]: index(releases) })
    }, [
      { id: 'gus', version: '0.2.1', apiRange: '^1.0.0', title: 'GUS', permissions: [] }
    ]);
    const gus = out.filter((e) => e.id === 'gus');
    expect(gus).toHaveLength(1);
    expect(gus[0]).toMatchObject({ version: '0.3.0', title: 'GUS (registry)', source: 'marketplace' });
  });

  it('keeps the bundled floor when the remote twin is INCOMPATIBLE', async () => {
    // Remote offers a newer gus that needs a host we cannot satisfy. The bundled
    // (compatible, installable) row must survive rather than being masked.
    const releases: RegistryRelease[] = [
      { id: 'gus', version: '9.0.0', zccApi: '>=2', url: 'https://cdn/gus.json', sha256: 'x', title: 'GUS (future)' }
    ];
    const { listMarketplace } = await importRegistry();
    const out = await listMarketplace([], undefined, {
      registryUrl: REG,
      deps: deps({ [REG]: index(releases) })
    }, [
      { id: 'gus', version: '0.2.1', apiRange: '^1.0.0', title: 'GUS', permissions: [] }
    ]);
    const gus = out.filter((e) => e.id === 'gus');
    expect(gus).toHaveLength(1);
    expect(gus[0]).toMatchObject({ version: '0.2.1', compatible: true, source: 'bundled' });
  });

  it('keeps the bundled floor when the remote twin is OLDER', async () => {
    const releases: RegistryRelease[] = [
      { id: 'gus', version: '0.1.0', zccApi: '>=1 <2', url: 'https://cdn/gus.json', sha256: 'x', title: 'GUS (old)' }
    ];
    const { listMarketplace } = await importRegistry();
    const out = await listMarketplace([], undefined, {
      registryUrl: REG,
      deps: deps({ [REG]: index(releases) })
    }, [
      { id: 'gus', version: '0.2.1', apiRange: '^1.0.0', title: 'GUS', permissions: [] }
    ]);
    const gus = out.filter((e) => e.id === 'gus');
    expect(gus).toHaveLength(1);
    expect(gus[0]).toMatchObject({ version: '0.2.1', source: 'bundled' });
  });

  it('passes optional catalog fields through fetchRegistryIndex (schema stays 1)', async () => {
    const { fetchRegistryIndex } = await importRegistry();
    const releases: RegistryRelease[] = [
      {
        id: 'alpha',
        version: '1.0.0',
        zccApi: '>=1 <2',
        url: 'https://cdn/a.json',
        sha256: 'x',
        title: 'Alpha',
        description: 'desc',
        author: 'A',
        icon: 'Box'
      }
    ];
    const idx = await fetchRegistryIndex(REG, deps({ [REG]: index(releases) }));
    expect(idx.schema).toBe(1);
    expect(idx.releases[0]).toMatchObject({ title: 'Alpha', description: 'desc', author: 'A', icon: 'Box' });
  });
});
