import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolveContainedReal } from '@zana-ai/zcc-path-confine';
import { parseMarketplaceIndex, type MarketplaceIndex } from './marketplace.js';
import { defaultFetchJson } from './plugin-process.js';

export const MARKETPLACE_MANIFEST_FILENAME = 'marketplace.json';
const SOURCE_FORMS = 'expected "https://<manifest-url>", "git:<url>[@<ref>]", or "path:<directory>"';
const DEFAULT_GIT_TIMEOUT_MS = 30_000;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024;
const MAX_CONCURRENT_GIT_MATERIALIZATIONS = 2;

export function createGitMaterializationGate(maxConcurrent = MAX_CONCURRENT_GIT_MATERIALIZATIONS) {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async <T>(operation: () => Promise<T>): Promise<T> => {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await operation();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

const withGitMaterializationSlot = createGitMaterializationGate();

export type MarketplaceSourceKind = 'https' | 'git' | 'path';

export type MarketplaceSource =
  | { kind: 'https'; manifestUrl: string }
  | { kind: 'git'; url: string; ref: string }
  | { kind: 'path'; directory: string };

function parseUrl(
  raw: string,
  protocols: readonly string[],
  allowsUser: (url: URL) => boolean = () => false
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid marketplace URL');
  }
  if (!protocols.includes(url.protocol)) {
    throw new Error('invalid marketplace URL');
  }
  if ((!allowsUser(url) && (url.username || url.password)) || url.search || url.hash) {
    throw new Error('invalid marketplace URL: credentials, query strings, and fragments are refused');
  }
  return url;
}

function parseGitSpec(spec: string): MarketplaceSource {
  const schemeEnd = spec.indexOf('://') + '://'.length;
  const authorityEnd = spec.slice(schemeEnd).search(/[/?#]/u);
  const authority = authorityEnd < 0 ? spec.slice(schemeEnd) : spec.slice(schemeEnd, schemeEnd + authorityEnd);
  if (authority.includes('@') && !authority.startsWith('git@')) {
    throw new Error('invalid marketplace URL: credentials, query strings, and fragments are refused');
  }
  // The userinfo separator belongs to the authority. Only a later @ can select a ref.
  const pathStart = authorityEnd < 0 ? spec.length : schemeEnd + authorityEnd;
  const split = spec.lastIndexOf('@');
  const hasRef = split > pathStart;
  const url = hasRef ? spec.slice(0, split) : spec;
  const ref = hasRef ? spec.slice(split + 1) : 'HEAD';
  if (!url || !ref) throw new Error('invalid marketplace git source');
  const parsed = parseUrl(url, ['https:', 'ssh:'], (parsedUrl) => (
    parsedUrl.protocol === 'ssh:' && parsedUrl.username === 'git' && !parsedUrl.password
  ));
  return { kind: 'git', url: parsed.toString(), ref };
}

function parseScpGitSpec(source: string): MarketplaceSource | null {
  const match = /^git@([A-Za-z0-9.-]+):([^?#\s]+)$/u.exec(source);
  if (!match) return null;
  const [, host, path] = match;
  return parseGitSpec(`ssh://git@${host}/${path}`);
}

export function parseMarketplaceSource(raw: string): MarketplaceSource {
  const source = raw.trim();
  if (source.length === 0) {
    throw new Error(`invalid marketplace source: ${SOURCE_FORMS}`);
  }
  if (source.startsWith('path:')) {
    const directory = source.slice('path:'.length);
    if (directory.length === 0) throw new Error('marketplace source has an empty path');
    return { kind: 'path', directory: resolve(directory) };
  }
  if (source.startsWith('git:')) {
    return parseGitSpec(source.slice('git:'.length));
  }
  if (/^git\+https:\/\//iu.test(source) || /^git\+ssh:\/\//iu.test(source)) {
    return parseGitSpec(source.replace(/^git\+/iu, ''));
  }
  const scpGit = parseScpGitSpec(source);
  if (scpGit) return scpGit;
  if (/^https:\/\//iu.test(source)) {
    return { kind: 'https', manifestUrl: parseUrl(source, ['https:']).toString() };
  }
  if (/^http:\/\//iu.test(source)) {
    throw new Error(`invalid marketplace source "${source}": plain http is refused, use https`);
  }
  throw new Error(`invalid marketplace source "${source}": ${SOURCE_FORMS}`);
}

/**
 * A bare repository-shaped HTTPS URL is ambiguous: try it as a manifest first,
 * then as a shallow Git repository. Explicit git: sources skip this fallback.
 */
export function resolveMarketplaceSource(source: MarketplaceSource): MarketplaceSource[] {
  if (source.kind !== 'https') return [source];
  const url = new URL(source.manifestUrl);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 2 || /\.[a-z0-9]+$/iu.test(parts[1] ?? '')) return [source];
  return [source, { kind: 'git', url: source.manifestUrl, ref: 'HEAD' }];
}

export function marketplaceSourceDisplay(source: MarketplaceSource): string {
  if (source.kind === 'https') return source.manifestUrl;
  if (source.kind === 'path') return `path:${source.directory}`;
  return source.ref === 'HEAD' ? `git:${source.url}` : `git:${source.url}@${source.ref}`;
}

function normalizeGitUrl(url: string): string {
  return url.replace(/\/+$/u, '').replace(/\.git$/iu, '');
}

/** Stable identity for catalog rows so `foo.git` and `foo` match. */
export function marketplaceSourceKey(source: MarketplaceSource): string {
  if (source.kind === 'https') return `https:${source.manifestUrl}`;
  if (source.kind === 'path') return `path:${source.directory}`;
  const url = normalizeGitUrl(source.url);
  return source.ref === 'HEAD' ? `git:${url}` : `git:${url}@${source.ref}`;
}

export function marketplaceSourcesEqual(a: string, b: string): boolean {
  try {
    return marketplaceSourceKey(parseMarketplaceSource(a)) === marketplaceSourceKey(parseMarketplaceSource(b));
  } catch {
    return a === b;
  }
}

export interface MarketplaceMaterializeOptions {
  timeoutMs?: number;
  /** Seed path only: no TTY prompts. Keeps the user's credential helper. */
  nonInteractive?: boolean;
  /** Test seam for controlled Git lifecycle execution. */
  runGit?: (args: string[], options: MarketplaceMaterializeOptions) => Promise<string>;
  /** Test seam for isolated Git materialization scheduling. */
  withGitMaterializationSlot?: <T>(operation: () => Promise<T>) => Promise<T>;
}

function isNotManifestError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error instanceof SyntaxError || error.name === 'ZodError';
}

async function runGit(args: string[], options: MarketplaceMaterializeOptions = {}): Promise<string> {
  return await new Promise((settle, reject) => {
    const env = { ...process.env };
    // Marketplace adds run without a terminal. Keep credential helpers enabled,
    // but never let Git block indefinitely waiting for interactive credentials.
    env.GIT_TERMINAL_PROMPT = '0';
    const timeoutMs = options.timeoutMs != null && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_GIT_TIMEOUT_MS;
    const child = spawn('git', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      detached: true
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const killChild = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
          return;
        } catch {
          /* process-group kill is Unix-only */
        }
      }
      child.kill('SIGKILL');
    };
    const finish = (error: Error | null, value?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else settle(value ?? '');
    };
    const timer = setTimeout(() => {
      killChild();
      finish(new Error(`git clone timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const appendOutput = (current: string, chunk: string): string | null => {
      if (Buffer.byteLength(current) + Buffer.byteLength(chunk) > MAX_GIT_OUTPUT_BYTES) {
        killChild();
        finish(new Error(`git clone output exceeded ${MAX_GIT_OUTPUT_BYTES} bytes`));
        return null;
      }
      return current + chunk;
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      const next = appendOutput(stdout, chunk);
      if (next != null) stdout = next;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const next = appendOutput(stderr, chunk);
      if (next != null) stderr = next;
    });
    child.on('error', () => finish(new Error('git clone could not start')));
    child.on('close', (code) => {
      if (code === 0) finish(null, stdout.trim());
      else finish(new Error('git clone failed'));
    });
  });
}

async function readMarketplaceJson(directory: string): Promise<MarketplaceIndex> {
  const realRoot = realpathSync(directory);
  const manifest = await resolveContainedReal(realRoot, MARKETPLACE_MANIFEST_FILENAME);
  if (!manifest) throw new Error(`marketplace.json not found in ${directory}`);
  const size = (await stat(manifest)).size;
  if (size > 1_048_576) throw new Error('marketplace manifest exceeds 1048576 bytes');
  return parseMarketplaceIndex(JSON.parse(await readFile(manifest, 'utf8')) as unknown);
}

export async function materializeMarketplaceSource(
  source: MarketplaceSource,
  fetchJson: (url: string) => Promise<unknown> = defaultFetchJson,
  options: MarketplaceMaterializeOptions = {}
): Promise<{ source: MarketplaceSource; index: MarketplaceIndex }> {
  if (source.kind === 'path') {
    const isDirectory = await stat(source.directory).then((entry) => entry.isDirectory()).catch(() => false);
    if (!isDirectory) throw new Error(`marketplace directory does not exist: ${source.directory}`);
    return { source, index: await readMarketplaceJson(source.directory) };
  }
  const candidates = resolveMarketplaceSource(source);
  let manifestError: unknown;
  for (const candidate of candidates) {
    if (candidate.kind === 'https') {
      try {
        return { source: candidate, index: parseMarketplaceIndex(await fetchJson(candidate.manifestUrl)) };
      } catch (error) {
        if (!isNotManifestError(error)) throw error;
        manifestError = error;
        continue;
      }
    }
    if (candidate.kind === 'git') {
      return await (options.withGitMaterializationSlot ?? withGitMaterializationSlot)(async () => {
        const staging = await mkdtemp(join(tmpdir(), 'zcc-marketplace-'));
        try {
          const cloneArgs = ['-c', 'core.hooksPath=/dev/null', 'clone', '--quiet', '--depth', '1', '--no-recurse-submodules'];
          if (candidate.ref !== 'HEAD') cloneArgs.push('--branch', candidate.ref);
          cloneArgs.push(candidate.url, staging);
          await (options.runGit ?? runGit)(cloneArgs, options);
          return { source: candidate, index: await readMarketplaceJson(staging) };
        } finally {
          await rm(staging, { recursive: true, force: true }).catch(() => undefined);
        }
      });
    }
  }
  throw manifestError instanceof Error ? manifestError : new Error('marketplace source could not be materialized');
}

export async function materializeMarketplaceIndex(
  source: MarketplaceSource,
  fetchJson: (url: string) => Promise<unknown> = defaultFetchJson,
  options: MarketplaceMaterializeOptions = {}
): Promise<MarketplaceIndex> {
  return (await materializeMarketplaceSource(source, fetchJson, options)).index;
}
