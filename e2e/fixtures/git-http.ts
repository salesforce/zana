/**
 * Local HTTPS Git smart-HTTP server for E2E clones. It exposes caller-owned
 * bare repositories through `git http-backend`, so tests use Git's real
 * upload-pack protocol rather than a file:// or mocked transport.
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:https';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** One repository's source, spelled as an inline file map. */
export interface GitHttpRepoSpec {
  /** Repository folder name served as `<repoName>.git`. */
  repoName: string;
  /** Files to write into the initial commit (relative path -> contents). */
  files: Record<string, string>;
  /** Optional tag on the initial commit. */
  tag?: string;
}

export interface GitHttpServer {
  /** HTTPS base, e.g. https://localhost:54321 (no trailing slash). */
  baseUrl: string;
  /** Clone URL for a repo, e.g. https://localhost:54321/gus.git. */
  urlFor(repoName: string): string;
  /** Bare HTTPS repository URL accepted by Catalog Sources. */
  bareUrlFor(repoName: string): string;
  /** Self-signed CA cert. Pass as `GIT_SSL_CAINFO` when cloning with Git. */
  caCertPath: string;
  close(): Promise<void>;
}

function gitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value;
  return {
    ...env,
    GIT_AUTHOR_NAME: 'E2E',
    GIT_AUTHOR_EMAIL: 'e2e@example.com',
    GIT_COMMITTER_NAME: 'E2E',
    GIT_COMMITTER_EMAIL: 'e2e@example.com',
    ...extra,
  };
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, env: gitEnv(), stdio: 'ignore' });
}

function isSafeRepoName(repoName: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repoName) && !repoName.includes('..');
}

function safePathInfo(rawUrl: string | undefined): string | undefined {
  const pathname = (rawUrl ?? '/').split('?', 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) return undefined;
  const relative = decoded.slice(1);
  if (relative.split('/').some((segment) => segment === '.' || segment === '..')) return undefined;
  if (!relative || normalize(relative).startsWith(`..${sep}`) || normalize(relative) === '..') return undefined;
  const segments = relative.split('/');
  const repositoryIndex = segments[0]?.endsWith('.git') ? 0 : 1;
  const repo = segments[repositoryIndex];
  if (!repo || !isSafeRepoName(repo.endsWith('.git') ? repo.slice(0, -4) : repo)) return undefined;
  const repository = repo.endsWith('.git') ? repo : `${repo}.git`;
  return `/${[repository, ...segments.slice(repositoryIndex + 1)].join('/')}`;
}

function writeBackendResponse(child: ReturnType<typeof spawn>, res: ServerResponse): void {
  let header = Buffer.alloc(0);
  let started = false;
  child.stdout.on('data', (chunk: Buffer) => {
    if (started) {
      res.write(chunk);
      return;
    }
    header = Buffer.concat([header, chunk]);
    const separator = header.indexOf('\r\n\r\n');
    if (separator < 0) {
      if (header.length > 16 * 1024) {
        child.kill('SIGKILL');
        res.writeHead(500).end('git http-backend sent oversized headers');
      }
      return;
    }

    let status = 200;
    for (const line of header.subarray(0, separator).toString('latin1').split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon < 1) continue;
      const name = line.slice(0, colon);
      const value = line.slice(colon + 1).trim();
      if (name.toLowerCase() === 'status') {
        const parsed = Number.parseInt(value, 10);
        if (parsed >= 100 && parsed <= 599) status = parsed;
      } else if (/^[A-Za-z0-9-]+$/.test(name)) {
        res.setHeader(name, value);
      }
    }
    res.writeHead(status);
    const body = header.subarray(separator + 4);
    if (body.length) res.write(body);
    started = true;
  });
  child.stdout.on('end', () => {
    if (!started && !res.headersSent) {
      res.writeHead(500).end('git http-backend sent an invalid response');
      return;
    }
    if (started) res.end();
  });
}

function serveGitRequest(
  req: IncomingMessage,
  res: ServerResponse,
  bareRoot: string
): void {
  const requestedPath = (req.url ?? '').split('?', 1)[0];
  const bareRepo = requestedPath.match(/^\/[A-Za-z0-9][A-Za-z0-9._-]*\/([A-Za-z0-9][A-Za-z0-9._-]*)$/);
  if (bareRepo && isSafeRepoName(bareRepo[1]!)) {
    // Catalog Sources probes a bare HTTPS value as a manifest first. A normal
    // Git web front door responds successfully with non-JSON before its smart
    // HTTP endpoints handle /info/refs and /git-upload-pack.
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Git</title>');
    return;
  }
  const pathInfo = safePathInfo(req.url);
  if (!pathInfo) {
    res.writeHead(404).end('not found');
    return;
  }

  const child = spawn('git', ['http-backend'], {
    env: gitEnv({
      GIT_PROJECT_ROOT: bareRoot,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: pathInfo,
      REQUEST_METHOD: req.method ?? 'GET',
      QUERY_STRING: (req.url ?? '').split('?', 2)[1] ?? '',
      CONTENT_TYPE: req.headers['content-type'] ?? '',
      CONTENT_LENGTH: req.headers['content-length'] ?? '',
      REMOTE_ADDR: req.socket.remoteAddress ?? '127.0.0.1',
      SERVER_PROTOCOL: `HTTP/${req.httpVersion}`,
    }),
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  child.on('error', () => {
    if (!res.headersSent) res.writeHead(500).end('failed to start git http-backend');
  });
  if (req.method === 'POST') {
    req.pipe(child.stdin);
  } else {
    // http-backend reads stdin until EOF. A GET has no request body, and piping
    // the already-ended IncomingMessage can leave the CGI process waiting.
    child.stdin.end();
  }
  writeBackendResponse(child, res);
}

/** Build repositories and serve them through Git's smart HTTPS transport. */
export async function startGitHttpServer(
  workDir: string,
  specs: GitHttpRepoSpec[]
): Promise<GitHttpServer> {
  const srcRoot = join(workDir, 'src');
  const bareRoot = join(workDir, 'bare');
  mkdirSync(srcRoot, { recursive: true });
  mkdirSync(bareRoot, { recursive: true });

  for (const spec of specs) {
    if (!isSafeRepoName(spec.repoName)) throw new Error(`unsafe repo name: ${spec.repoName}`);
    const source = join(srcRoot, spec.repoName);
    mkdirSync(source, { recursive: true });
    for (const [relativePath, contents] of Object.entries(spec.files)) {
      const destination = join(source, relativePath);
      if (!destination.startsWith(`${source}${sep}`)) throw new Error(`unsafe repo path: ${relativePath}`);
      mkdirSync(join(destination, '..'), { recursive: true });
      writeFileSync(destination, contents);
    }
    git(source, 'init', '-q', '-b', 'main');
    git(source, 'add', '.');
    git(source, 'commit', '-qm', 'initial');
    if (spec.tag) git(source, 'tag', spec.tag);
    execFileSync('git', ['clone', '-q', '--bare', source, join(bareRoot, `${spec.repoName}.git`)], {
      env: gitEnv(),
      stdio: 'ignore',
    });
  }

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

  const server: Server = createServer(
    { key: readFileSync(tlsKey), cert: readFileSync(tlsCert) },
    (req, res) => serveGitRequest(req, res, bareRoot)
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as { port: number }).port;
  const baseUrl = `https://localhost:${port}`;

  const first = specs[0]?.repoName;
  if (first) {
    try {
      await execFileAsync('git', ['ls-remote', `${baseUrl}/org/${first}`], {
        env: gitEnv({ GIT_SSL_CAINFO: tlsCert }),
        timeout: 5_000,
      });
    } catch (error) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw new Error('git HTTPS server never became reachable', { cause: error });
    }
  }

  return {
    baseUrl,
    urlFor: (repoName: string) => {
      if (!isSafeRepoName(repoName)) throw new Error(`unsafe repo name: ${repoName}`);
      return `${baseUrl}/${repoName}.git`;
    },
    bareUrlFor: (repoName: string) => {
      if (!isSafeRepoName(repoName)) throw new Error(`unsafe repo name: ${repoName}`);
      return `${baseUrl}/org/${repoName}`;
    },
    caCertPath: tlsCert,
    close: () => {
      // Git may keep its HTTP connection alive after a request. Do not leave a
      // caller's E2E process waiting for that idle socket to time out.
      server.closeAllConnections();
      return new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}
