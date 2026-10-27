import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { z } from 'zod';
import { scanPluginFiles } from './plugin-file-scan.js';

const unzip = promisify(gunzip);
const MAX_BYTES = 64 * 1024 * 1024;
const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(128);
const indexSchema = z.object({
  version: z.literal(1), zccVersion: z.string(),
  plugins: z.array(z.object({ id, file: z.string().regex(/^plugin-recovery-[a-zA-Z0-9._-]+\.json\.gz$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(256)
}).strict();
const payloadSchema = z.object({ version: z.literal(1), id,
  files: z.array(z.object({ path: z.string().min(1).max(1024), base64: z.string(), executable: z.boolean() }).strict()).max(10_000)
}).strict();

/** Keep rollback code inside managed storage, including for an app-owned bundle. */
export async function copyRecoveryRollbackRuntime(dataDir: string, source: string): Promise<string> {
  const generation = join(dataDir, 'plugins', 'generations', randomUUID());
  const root = join(generation, 'rollback');
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    const exists = await stat(source).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    let size = 0;
    for (const file of exists ? await scanPluginFiles(source, 10_000) : []) {
      const original = join(source, file);
      size += (await stat(original)).size;
      if (size > MAX_BYTES) throw new Error('Rollback runtime exceeds the size limit');
      await mkdir(dirname(join(root, file)), { recursive: true, mode: 0o700 });
      await copyFile(original, join(root, file));
    }
    return root;
  } catch (error) { await rm(generation, { recursive: true, force: true }); throw error; }
}

/** Fixed release assets, or an explicitly configured mirror owned by the host. */
export function pluginRecoveryUrl(version: string): string {
  return process.env.ZCC_PLUGIN_RECOVERY_URL?.trim() ||
    `https://github.com/salesforce/zana/releases/download/v${encodeURIComponent(version)}/plugin-recovery-${process.platform}-${process.arch}.json`;
}

function allowedUrl(url: URL, origin: URL): boolean {
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)) return url.origin === origin.origin;
  return url.protocol === 'https:' && (url.origin === origin.origin ||
    (origin.hostname === 'github.com' && ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname)));
}

/** Bound every response and redirect; no credentials or cookies are forwarded. */
export async function fetchRecoveryBytes(url: string, maxBytes: number, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const origin = new URL(url);
  let current = origin;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (!allowedUrl(current, origin)) throw new Error('Plugin recovery requires HTTPS or a loopback mirror');
    const response = await fetcher(current, { redirect: 'manual', signal: deadline, cache: 'no-store' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('Plugin recovery redirect has no location');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Plugin recovery download failed (${response.status}). Publish the recovery artifacts for this Zana release or configure a recovery mirror.`);
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > maxBytes) throw new Error('Plugin recovery download exceeds the size limit');
        chunks.push(Buffer.from(next.value));
      }
      return Buffer.concat(chunks);
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  throw new Error('Too many plugin recovery redirects');
}

export function createOfficialPluginRecovery(args: { dataDir: string; hostVersion: string; signal: AbortSignal; fetcher?: typeof fetch }) {
  const url = pluginRecoveryUrl(args.hostVersion);
  let index: Promise<z.infer<typeof indexSchema>> | undefined;
  return async (pluginId: string): Promise<string> => {
    index ??= fetchRecoveryBytes(url, 1_048_576, args.signal, args.fetcher).then(bytes => {
      const value = indexSchema.parse(JSON.parse(bytes.toString('utf8')));
      if (value.zccVersion !== args.hostVersion) throw new Error(`Recovery artifacts target Zana ${value.zccVersion}; running ${args.hostVersion}`);
      if (new Set(value.plugins.map(row => row.id)).size !== value.plugins.length) throw new Error('Duplicate recovery plugin identities');
      return value;
    });
    const entry = (await index).plugins.find(row => row.id === pluginId);
    if (!entry) throw new Error('No published recovery runtime for this plugin');
    const bytes = await fetchRecoveryBytes(new URL(entry.file, url).href, MAX_BYTES, args.signal, args.fetcher);
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Plugin recovery checksum mismatch');
    const payload = payloadSchema.parse(JSON.parse((await unzip(bytes, { maxOutputLength: MAX_BYTES * 2 })).toString('utf8')));
    if (payload.id !== pluginId) throw new Error('Plugin recovery identity mismatch');
    const generation = join(args.dataDir, 'plugins', 'generations', randomUUID());
    const root = join(generation, 'runtime');
    const seen = new Set<string>();
    let size = 0;
    try {
      for (const file of payload.files) {
        args.signal.throwIfAborted();
        if (file.path.includes('\\') || file.path.includes(':') || file.path.includes('\0') ||
            file.path.split('/').some(part => !part || part === '.' || part === '..') || seen.has(file.path.toLowerCase())) {
          throw new Error('Invalid or duplicate recovery file path');
        }
        seen.add(file.path.toLowerCase());
        const content = Buffer.from(file.base64, 'base64');
        size += content.length;
        if (size > MAX_BYTES || content.toString('base64') !== file.base64) throw new Error('Invalid or excessive recovery file data');
        const target = join(root, file.path);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, content, { flag: 'wx', mode: file.executable ? 0o700 : 0o600 });
      }
      return root;
    } catch (error) { await rm(generation, { recursive: true, force: true }); throw error; }
  };
}
