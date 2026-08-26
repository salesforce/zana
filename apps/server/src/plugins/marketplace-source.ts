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

export type MarketplaceSourceKind = 'https' | 'git' | 'path';

export type MarketplaceSource =
  | { kind: 'https'; manifestUrl: string }
  | { kind: 'git'; url: string; ref: string }
  | { kind: 'path'; directory: string };

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
    const spec = source.slice('git:'.length);
    const split = spec.lastIndexOf('@');
    if (split <= 0) return { kind: 'git', url: spec, ref: 'HEAD' };
    const url = spec.slice(0, split);
    const ref = spec.slice(split + 1);
    if (!url || !ref) throw new Error(`invalid marketplace git source "${source}"`);
    return { kind: 'git', url, ref };
  }
  if (/^git\+https:\/\//iu.test(source) || /^git\+ssh:\/\//iu.test(source)) {
    const withoutPrefix = source.replace(/^git\+/iu, '');
    const split = withoutPrefix.lastIndexOf('@');
    if (split > 'https://'.length) {
      return { kind: 'git', url: withoutPrefix.slice(0, split), ref: withoutPrefix.slice(split + 1) };
    }
    return { kind: 'git', url: withoutPrefix, ref: 'HEAD' };
  }
  if (/^https:\/\//iu.test(source)) {
    return { kind: 'https', manifestUrl: source };
  }
  if (/^http:\/\//iu.test(source)) {
    throw new Error(`invalid marketplace source "${source}": plain http is refused, use https`);
  }
  throw new Error(`invalid marketplace source "${source}": ${SOURCE_FORMS}`);
}

export function marketplaceSourceDisplay(source: MarketplaceSource): string {
  if (source.kind === 'https') return source.manifestUrl;
  if (source.kind === 'path') return `path:${source.directory}`;
  return source.ref === 'HEAD' ? `git:${source.url}` : `git:${source.url}@${source.ref}`;
}

async function runGit(args: string[]): Promise<string> {
  return await new Promise((settle, reject) => {
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) settle(stdout.trim());
      else reject(new Error(stderr.trim() || `git ${args.join(' ')} failed`));
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

export async function materializeMarketplaceIndex(
  source: MarketplaceSource,
  fetchJson: (url: string) => Promise<unknown> = defaultFetchJson
): Promise<MarketplaceIndex> {
  if (source.kind === 'https') {
    return parseMarketplaceIndex(await fetchJson(source.manifestUrl));
  }
  if (source.kind === 'path') {
    const isDirectory = await stat(source.directory).then((entry) => entry.isDirectory()).catch(() => false);
    if (!isDirectory) throw new Error(`marketplace directory does not exist: ${source.directory}`);
    return readMarketplaceJson(source.directory);
  }
  const staging = await mkdtemp(join(tmpdir(), 'zcc-marketplace-'));
  try {
    const cloneArgs = ['-c', 'core.hooksPath=/dev/null', 'clone', '--quiet', '--depth', '1'];
    if (source.ref !== 'HEAD') cloneArgs.push('--branch', source.ref);
    cloneArgs.push(source.url, staging);
    await runGit(cloneArgs);
    return await readMarketplaceJson(staging);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
