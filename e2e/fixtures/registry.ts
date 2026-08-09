/**
 * Local HTTPS marketplace registry — a faithful stand-in for the not-yet-hosted
 * production registry. It exercises the SAME contracts the shipped engine
 * enforces (HTTPS-only, sha256 integrity, Ed25519 signature), so a green E2E
 * means the real install path works end to end:
 *
 *   1. Generate a self-signed TLS cert for localhost (trusted by the app via
 *      NODE_EXTRA_CA_CERTS — real TLS verification, NOT disabled).
 *   2. Generate an Ed25519 signing keypair (the registry signing key).
 *   3. Build a dummy extension artifact + publish it with the REAL
 *      scripts/publish-extension.mjs (signed). No bespoke archive shaping — the
 *      test uses the same tool an author would.
 *   4. Serve the resulting registry dir over HTTPS on an ephemeral port.
 *
 * The published index `url` is rewritten to the live port so the app fetches
 * the archive from this server.
 */
import { createServer, type Server } from 'node:https';
import { generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface LocalRegistry {
  /** HTTPS base, e.g. https://localhost:54321 (no trailing slash). */
  baseUrl: string;
  /** Full index URL the app's registry config should point at. */
  indexUrl: string;
  /** PEM public key matching the signed archives (for `publicKey` in config). */
  publicKeyPem: string;
  /** Path to the self-signed CA cert — pass as NODE_EXTRA_CA_CERTS to the app. */
  caCertPath: string;
  /** The id + version published into the registry. */
  extension: { id: string; version: string; permissions: string[] };
  close(): Promise<void>;
}

export interface DummyExtensionSpec {
  id?: string;
  version?: string;
  title?: string;
  permissions?: string[];
}

/**
 * Stand up a signed HTTPS registry serving one dummy extension out of `workDir`
 * (a throwaway tmp dir owned by the caller). Returns once the server is
 * listening.
 */
export async function startLocalRegistry(
  workDir: string,
  spec: DummyExtensionSpec = {}
): Promise<LocalRegistry> {
  const id = spec.id ?? 'e2e-dummy';
  const version = spec.version ?? '1.0.0';
  const permissions = spec.permissions ?? ['storage'];

  mkdirSync(workDir, { recursive: true });

  // --- 1. Self-signed TLS cert for localhost (LibreSSL/OpenSSL both OK) ---
  const tlsKey = join(workDir, 'tls.key');
  const tlsCert = join(workDir, 'tls.crt');
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', tlsKey, '-out', tlsCert,
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-days', '2',
    ],
    { stdio: 'ignore' }
  );

  // --- 2. Ed25519 signing keypair (Node — LibreSSL's genpkey lacks ed25519) ---
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signingKeyPath = join(workDir, 'signing.pem');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  writeFileSync(signingKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());

  // --- 3. Dummy extension artifact ---
  const artifactDir = join(workDir, 'artifact', id);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    join(artifactDir, 'extension.json'),
    JSON.stringify(
      {
        id,
        version,
        title: spec.title ?? 'E2E Dummy',
        icon: 'Sparkles',
        titleLabel: spec.title ?? 'E2E Dummy',
        entry: { main: 'main.mjs' },
        engines: { zccApi: '^1.0.0' },
        permissions,
      },
      null,
      2
    )
  );
  writeFileSync(
    join(artifactDir, 'main.mjs'),
    `export default { id: ${JSON.stringify(id)}, setup(ctx) { ctx.log('${id} activated'); return { ping: async () => 'pong' }; } };\n`
  );

  // --- 3b. Publish with the REAL tool (signed) ---
  const registryDir = join(workDir, 'registry');
  // We don't know the port yet — publish with a placeholder base, then rewrite
  // the index `url` once the server is listening (below).
  execFileSync(
    'node',
    [
      join(REPO_ROOT, 'scripts/publish-extension.mjs'),
      artifactDir,
      '--out', registryDir,
      '--base-url', 'https://localhost',
      '--key', signingKeyPath,
    ],
    { stdio: 'ignore', cwd: REPO_ROOT }
  );

  // --- 4. Serve the registry dir over HTTPS on an ephemeral port ---
  const server: Server = createServer(
    { key: readFileSync(tlsKey), cert: readFileSync(tlsCert) },
    (req, res) => {
      const name = (req.url ?? '/').split('?')[0].replace(/^\/+/, '') || 'index.json';
      // Containment: serve only files inside registryDir.
      const file = join(registryDir, name);
      if (!file.startsWith(registryDir)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      try {
        res.writeHead(200, { 'content-type': 'application/json' }).end(readFileSync(file));
      } catch {
        res.writeHead(404).end('not found');
      }
    }
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `https://localhost:${port}`;

  // Rewrite the published index so each release `url` points at the live port.
  const indexPath = join(registryDir, 'index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
  for (const rel of index.releases) {
    rel.url = rel.url.replace('https://localhost/', `${baseUrl}/`);
  }
  writeFileSync(indexPath, JSON.stringify(index, null, 2));

  return {
    baseUrl,
    indexUrl: `${baseUrl}/index.json`,
    publicKeyPem,
    caCertPath: tlsCert,
    extension: { id, version, permissions },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}
