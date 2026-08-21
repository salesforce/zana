/**
 * Boot the REAL `website/` standalone server (the Phase 6 publish backend)
 * against a temp SQLite DB + a generated Ed25519 keypair, then front it with
 * a self-signed HTTPS reverse proxy — mirroring how `registry.ts` already
 * gives the app a trusted local HTTPS endpoint.
 *
 * WHY a proxy instead of serving Next directly over HTTPS: `next start`'s
 * `--experimental-https` flag is dev-only and unsupported for the built
 * `standalone/server.js` this fixture runs (production semantics — the same
 * server.js a real deploy's Docker image runs). The desktop engine
 * (`fetchRegistryIndex`/`applyRelease` in `apps/server/src/services/extensions/extension-registry.ts`)
 * hard-requires `https://` release/index URLs, so a thin same-process HTTPS
 * front door (self-signed cert, trusted via `NODE_EXTRA_CA_CERTS` — same
 * mechanism `registry.ts` uses) that reverse-proxies to the plain-HTTP Next
 * server is the most faithful way to satisfy that gate without inventing a
 * second registry implementation. The website itself is never modified to
 * speak TLS — that stays an infra/ingress concern in real deployments.
 */
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WEBSITE_ROOT = join(REPO_ROOT, 'website');

export interface WebsiteServer {
  /** Plain-HTTP base the Next standalone server actually listens on (loopback only). */
  httpBaseUrl: string;
  /** HTTPS base fronting it — what the app's registry config + CLI --api should use. */
  baseUrl: string;
  /** PEM public key matching `REGISTRY_SIGNING_KEY` — for the app's `publicKey` config. */
  publicKeyPem: string;
  /** Self-signed CA cert path — pass as `NODE_EXTRA_CA_CERTS` to any HTTPS caller (app or CLI). */
  caCertPath: string;
  close(): Promise<void>;
}

function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      fetch(url)
        .then((res) => {
          if (res.ok) resolve();
          else if (Date.now() > deadline) reject(new Error(`${url} never returned ok (last status ${res.status})`));
          else setTimeout(attempt, 200);
        })
        .catch((err) => {
          if (Date.now() > deadline) reject(new Error(`${url} never became reachable: ${err instanceof Error ? err.message : err}`));
          else setTimeout(attempt, 200);
        });
    };
    attempt();
  });
}

/**
 * Build the website once (`npm run build` in `website/`) if `.next/standalone`
 * isn't already present. Safe to call repeatedly — a no-op once built.
 */
export function ensureWebsiteBuilt(): void {
  const serverEntry = join(WEBSITE_ROOT, '.next', 'standalone', 'server.js');
  if (existsSync(serverEntry)) return;
  execFileSync('npm', ['run', 'build'], { cwd: WEBSITE_ROOT, stdio: 'inherit' });
}

/**
 * Boot the built website against a fresh temp SQLite DB, run migrations, mint
 * an Ed25519 keypair for `REGISTRY_SIGNING_KEY`/`REGISTRY_PUBLIC_KEY`, and
 * front the whole thing with a self-signed HTTPS proxy on an ephemeral port.
 */
export async function startWebsiteServer(workDir: string): Promise<WebsiteServer> {
  ensureWebsiteBuilt();
  mkdirSync(workDir, { recursive: true });

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const dbPath = join(workDir, 'e2e-publish.db');
  const databaseUrl = `file:${dbPath}`;

  // --- TLS cert for the HTTPS front door (same recipe as registry.ts) ---
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

  // --- Run migrations against the fresh DB ---
  execFileSync('node', ['lib/db/migrate.mjs'], {
    cwd: WEBSITE_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  // --- Start the HTTPS front door FIRST (bound to an ephemeral port) so its
  // port is known before the Next server boots — PUBLIC_BASE_URL must be set
  // at Next's startup since it's read per-request to build release.url values,
  // and callers only ever see the HTTPS base. The proxy target (httpPort)
  // is filled in once the Next server itself is listening, below. ---
  const httpPort = await pickFreePort();
  const proxy: HttpsServer = createHttpsServer(
    { key: readFileSync(tlsKey), cert: readFileSync(tlsCert) },
    (req, res) => {
      const proxyReq = httpRequest(
        { host: '127.0.0.1', port: httpPort, path: req.url, method: req.method, headers: req.headers },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );
      proxyReq.on('error', (err) => {
        if (!res.headersSent) res.writeHead(502);
        res.end(`proxy error: ${err instanceof Error ? err.message : String(err)}`);
      });
      req.pipe(proxyReq);
    }
  );
  const proxyPort = await new Promise<number>((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', () => resolve((proxy.address() as AddressInfo).port));
  });
  const httpsBaseUrl = `https://localhost:${proxyPort}`;

  // --- Boot the standalone Next server on the pre-picked HTTP port (loopback only) ---
  const child: ChildProcess = spawn(
    process.execPath,
    [join(WEBSITE_ROOT, '.next', 'standalone', 'server.js')],
    {
      cwd: join(WEBSITE_ROOT, '.next', 'standalone'),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        GITHUB_OAUTH_MODE: 'mock',
        SESSION_SECRET: 'e2e-publish-session-secret',
        REGISTRY_SIGNING_KEY: privateKeyPem,
        REGISTRY_PUBLIC_KEY: publicKeyPem,
        PUBLIC_BASE_URL: httpsBaseUrl,
        PORT: String(httpPort),
        HOSTNAME: '127.0.0.1',
      },
      stdio: 'inherit',
    }
  );

  const httpBaseUrl = `http://127.0.0.1:${httpPort}`;
  await waitForHttpOk(`${httpBaseUrl}/api/healthz`, 30_000);

  return {
    httpBaseUrl,
    baseUrl: httpsBaseUrl,
    publicKeyPem,
    caCertPath: tlsCert,
    close: async () => {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      child.kill();
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        setTimeout(resolve, 3_000);
      });
    },
  };
}

async function pickFreePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}
