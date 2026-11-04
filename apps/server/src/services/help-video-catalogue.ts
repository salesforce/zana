import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  HELP_VIDEO_CATALOGUE_MAX_BYTES, helpVideoCatalogueSchema, helpVideoRevision,
  type HelpVideoAsset, type HelpVideoCatalogue, type HelpVideoView
} from '@zana-ai/zcc-server-contract';
import { compareVersions } from '@zana-ai/zcc-extension-sdk';
import bundledCatalogue from '../../../../content/videos/catalogue.json' with { type: 'json' };
import packageInfo from '../../../../package.json' with { type: 'json' };

export const HELP_VIDEO_REPO_BASE = 'https://raw.githubusercontent.com/salesforce/zana/main/';
export const HELP_VIDEO_REFRESH_MS = 5 * 60 * 1000;
export const HELP_VIDEO_CACHE_BYTES = 192 * 1024 * 1024;
const ASSET_TYPES = { src: ['mp4', 'video/mp4'], poster: ['jpg', 'image/jpeg'], captions: ['vtt', 'text/vtt; charset=utf-8'] } as const;

interface RegisteredAsset { asset: HelpVideoAsset; type: string; name: string }
interface Options {
  /** Trusted construction seams. No renderer-supplied origins/paths. */
  fetch?: typeof fetch; baseUrl?: string; appVersion?: string; now?: () => number;
}

/** A fixed public content source; downloads are checked against the reviewed manifest. */
export class HelpVideoCatalogueService {
  private catalogue = helpVideoCatalogueSchema.parse(bundledCatalogue);
  private etag = '';
  private nextRefresh = 0;
  private loading?: Promise<void>;
  private refreshing?: Promise<void>;
  private readonly assets = new Map<string, RegisteredAsset>();
  private readonly downloads = new Map<string, Promise<string>>();
  private readonly controllers = new Set<AbortController>();
  private activeDownloads = 0;
  // Unique queued requests are bounded by the 540-entry asset registry.
  private readonly downloadSlots: Array<() => void> = [];
  private cacheWrite: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private readonly directory: string;
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly appVersion: string;
  private readonly now: () => number;

  constructor(dataDir: string, options: Options = {}) {
    this.directory = join(dataDir, 'help-videos');
    this.fetcher = options.fetch ?? fetch;
    // The environment override exists only in explicitly enabled isolated E2E runs.
    const testOrigin = process.env.ZCC_E2E === '1' ? process.env.ZCC_E2E_HELP_VIDEOS_ORIGIN : undefined;
    this.baseUrl = options.baseUrl ?? (testOrigin && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(testOrigin) ? testOrigin : HELP_VIDEO_REPO_BASE);
    this.appVersion = options.appVersion ?? packageInfo.version;
    this.now = options.now ?? Date.now;
    this.register(this.catalogue);
  }

  private register(catalogue: HelpVideoCatalogue): void {
    for (const video of catalogue.videos) {
      for (const [kind, [extension, type]] of Object.entries(ASSET_TYPES)) {
        const asset = video[kind as keyof typeof ASSET_TYPES];
        const name = `${asset.sha256}.${extension}`;
        this.assets.set(name, { asset, type, name });
      }
    }
    // Retain a bounded recent registry so refreshing doesn't invalidate a playing cut.
    while (this.assets.size > 540) this.assets.delete(this.assets.keys().next().value!);
  }

  private initialize(): Promise<void> {
    return this.loading ??= (async () => {
      // No downloads have started before initialization: remove leftovers from a crash.
      try {
        await mkdir(this.directory, { recursive: true });
        const names = await readdir(this.directory);
        await Promise.all(names.filter(name => /^(?:catalogue|[a-f0-9]{64}\.(?:mp4|jpg|vtt))-[a-f0-9-]+\.tmp$/.test(name))
          .map(name => rm(join(this.directory, name), { force: true })));
        await this.prune('');
      } catch { /* A read-only cache still permits the bundled baseline. */ }
      try {
        const path = join(this.directory, 'catalogue.json');
        if ((await stat(path)).size > HELP_VIDEO_CATALOGUE_MAX_BYTES + 2048) return;
        const saved = JSON.parse(await readFile(path, 'utf8'));
        const catalogue = helpVideoCatalogueSchema.parse(saved.catalogue);
        this.catalogue = catalogue;
        this.etag = typeof saved.etag === 'string' && saved.etag.length <= 512 && !/[\r\n]/.test(saved.etag) ? saved.etag : '';
        this.register(catalogue);
      } catch { /* First launch or damaged cache: keep the bundled baseline. */ }
    })();
  }

  private async request<T>(path: string, timeout: number, read: (response: Response) => Promise<T>, etag = ''): Promise<T> {
    if (this.disposed) throw new Error('Video catalogue stopped');
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await this.fetcher(new URL(path, this.baseUrl), {
        signal: controller.signal, redirect: 'error',
        headers: { 'Accept-Encoding': 'identity', ...(etag ? { 'If-None-Match': etag } : {}) }
      });
      try { return await read(response); }
      finally { if (!response.bodyUsed) await response.body?.cancel(); }
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.cacheWrite.then(operation);
    this.cacheWrite = next.catch(() => {});
    return next;
  }

  private async refresh(): Promise<void> {
    try {
      await this.request('content/videos/catalogue.json', 5000, async response => {
        if (response.status === 304) return;
        if (!response.ok || !response.body) throw new Error('Catalogue unavailable');
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > HELP_VIDEO_CATALOGUE_MAX_BYTES) throw new Error('Catalogue too large');
          chunks.push(chunk);
        }
        const catalogue = helpVideoCatalogueSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        const rawEtag = response.headers.get('etag') ?? '';
        const etag = rawEtag.length <= 512 && !/[\r\n]/.test(rawEtag) ? rawEtag : '';
        if (this.disposed) return;
        await this.serialized(async () => {
          await mkdir(this.directory, { recursive: true });
          const tmp = join(this.directory, `catalogue-${randomUUID()}.tmp`);
          try {
            const file = await open(tmp, 'wx', 0o600);
            try { await file.writeFile(JSON.stringify({ catalogue, etag })); }
            finally { await file.close(); }
            await rename(tmp, join(this.directory, 'catalogue.json'));
          } finally { await rm(tmp, { force: true }); }
        }).catch(() => {}); // Read-only disks may still use the valid in-memory catalogue.
        if (this.disposed) return;
        this.catalogue = catalogue;
        this.etag = etag;
        this.register(catalogue);
      }, this.etag);
    } catch { /* Network/schema failures retain the last known good catalogue. */ }
  }

  async list(): Promise<HelpVideoView[]> {
    await this.initialize();
    if (!this.disposed && this.now() >= this.nextRefresh) {
      this.nextRefresh = this.now() + HELP_VIDEO_REFRESH_MS;
      this.refreshing = this.refresh().finally(() => { this.refreshing = undefined; });
    }
    await this.refreshing;
    return this.catalogue.videos.filter(video =>
      (!video.minAppVersion || compareVersions(this.appVersion, video.minAppVersion) >= 0)
      && (!video.maxAppVersion || compareVersions(this.appVersion, video.maxAppVersion) <= 0)
    ).map(video => {
      const { src, poster, captions, minAppVersion: _min, maxAppVersion: _max, ...metadata } = video;
      const url = (asset: HelpVideoAsset, extension: string) => `/api/v1/help/videos/assets/${asset.sha256}.${extension}`;
      return { ...metadata, revision: helpVideoRevision(video), src: url(src, 'mp4'), poster: url(poster, 'jpg'), captions: url(captions, 'vtt') };
    });
  }

  private async prune(keep: string): Promise<void> {
    const names = (await readdir(this.directory)).filter(name => /^[a-f0-9]{64}\.(mp4|jpg|vtt)$/.test(name));
    const files = await Promise.all(names.map(async name => ({ name, info: await lstat(join(this.directory, name)) })));
    let bytes = files.reduce((sum, file) => sum + file.info.size, 0);
    let count = files.length;
    for (const file of files.sort((a, b) => a.info.mtimeMs - b.info.mtimeMs)) {
      if (bytes <= HELP_VIDEO_CACHE_BYTES && count <= 540) break;
      if (file.name === keep) continue;
      await rm(join(this.directory, file.name), { force: true });
      bytes -= file.info.size;
      count--;
    }
  }

  async asset(name: string): Promise<{ path: string; size: number; type: string } | null> {
    await this.initialize();
    const registered = this.assets.get(name);
    if (!registered) return null;
    const { asset, type } = registered;
    const target = join(this.directory, name);
    try {
      const info = await lstat(target);
      if (info.isFile() && info.size === asset.bytes) return { path: target, size: asset.bytes, type };
    } catch { /* Download the missing asset on demand. */ }
    let pending = this.downloads.get(name);
    if (!pending) {
      if (this.downloads.size >= 540) throw new Error('Video downloads busy');
      pending = this.scheduledDownload(asset, name).finally(() => { this.downloads.delete(name); });
      this.downloads.set(name, pending);
    }
    return { path: await pending, size: asset.bytes, type };
  }

  private async scheduledDownload(asset: HelpVideoAsset, name: string): Promise<string> {
    if (this.activeDownloads < 3) this.activeDownloads++;
    else await new Promise<void>(resolve => this.downloadSlots.push(resolve));
    try {
      if (this.disposed) throw new Error('Video catalogue stopped');
      return await this.download(asset, name);
    } finally {
      const next = this.downloadSlots.shift();
      if (next) next(); // Transfer the slot directly to a waiting request.
      else this.activeDownloads--;
    }
  }

  private async download(asset: HelpVideoAsset, name: string): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const tmp = join(this.directory, `${name}-${randomUUID()}.tmp`);
    const target = join(this.directory, name);
    try {
      await this.request(asset.path, 60_000, async response => {
        if (!response.ok || !response.body) throw new Error('Video unavailable');
        const declared = response.headers.get('content-length');
        const encoding = response.headers.get('content-encoding');
        if ((!encoding || encoding === 'identity') && declared && Number(declared) !== asset.bytes) throw new Error('Unexpected asset size');
        const file = await open(tmp, 'wx', 0o600);
        try {
          const hash = createHash('sha256');
          let size = 0;
          for await (const chunk of response.body) {
            size += chunk.byteLength;
            if (size > asset.bytes) throw new Error('Asset too large');
            hash.update(chunk);
            await file.writeFile(chunk);
          }
          if (size !== asset.bytes || hash.digest('hex') !== asset.sha256) throw new Error('Asset integrity check failed');
        } finally { await file.close(); }
      });
      if (this.disposed) throw new Error('Video catalogue stopped');
      await this.serialized(async () => {
        await rename(tmp, target);
        await this.prune(name);
      });
      return target;
    } finally { await rm(tmp, { force: true }); }
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
  }
}
