import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, readdir, rm, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, normalize, relative, resolve as resolvePath, sep } from 'node:path';
import { atomicDurableWrite, createSerializedTransactionQueue } from '../harness-routing-migration/storage.js';
import type { ExecutionSourceCapabilityView, ExecutionSourceSnapshot } from '../../shared/types.js';

export const EXECUTION_SOURCE_LIMITS = Object.freeze({
  maxFiles: 16,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxExtractedBytes: 8 * 1024 * 1024,
  maxSerializedSnapshotBytes: 9 * 1024 * 1024
  , maxOutstandingCapabilities: 128
});

interface SourceLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxExtractedBytes: number;
  maxSerializedSnapshotBytes: number;
  maxOutstandingCapabilities: number;
}
type SourceErrorCode = 'TOO_MANY_SOURCES' | 'DUPLICATE_SOURCE' | 'SOURCE_TOO_LARGE'
  | 'TOTAL_SOURCE_TOO_LARGE' | 'EXTRACTED_TEXT_TOO_LARGE' | 'INVALID_CAPABILITY'
  | 'FOREIGN_CAPABILITY' | 'EXPIRED_CAPABILITY' | 'REPLAYED_CAPABILITY'
  | 'SOURCE_CHANGED' | 'NOT_REGULAR_FILE' | 'INVALID_ENCODING' | 'BINARY_UNSUPPORTED'
  | 'MALFORMED_SOURCE' | 'UNSUPPORTED_SOURCE' | 'EXTRACTION_TIMEOUT' | 'INVALID_CONTENT_REF' | 'SOURCE_NOT_FOUND'
  | 'SERIALIZED_SNAPSHOT_TOO_LARGE';

export class ExecutionSourceError extends Error {
  constructor(readonly code: SourceErrorCode, message: string) {
    super(message);
    this.name = 'ExecutionSourceError';
  }
}

interface Capability {
  id: string;
  windowId: number;
  projectId: string;
  path: string;
  exactPath: string;
  representations: string[];
  name: string;
  byteSize: number;
  digest: string;
  issuedAt: number;
  expiresAt: number;
  used: boolean;
}

export interface ExecutionSourcePathDescriptor {
  exactPath: string;
  canonicalPath: string;
  representations: readonly string[];
}

interface RegistryOptions {
  rootDir: string;
  now?: () => number;
  id?: () => string;
  ttlMs?: number;
  limits?: Partial<SourceLimits>;
  readBytes?: (path: string) => Promise<Buffer>;
  readTimeoutMs?: number;
  removeDir?: (path: string) => Promise<void>;
}

const DEFAULT_TTL_MS = 10 * 60 * 1_000;
const snapshotQueue = createSerializedTransactionQueue();
const textualExtensions = new Set([
  '.txt', '.md', '.markdown', '.html', '.htm', '.json', '.yaml', '.yml', '.csv',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.java', '.go', '.rs', '.c',
  '.cc', '.cpp', '.h', '.hpp', '.sh', '.bash', '.zsh', '.css', '.scss', '.sql', '.xml',
  '.toml', '.ini', '.conf', '.properties', '.rb', '.php', '.swift', '.kt', '.kts'
]);

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function extension(name: string): string {
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index).toLowerCase();
}

function detect(bytes: Buffer, name: string): string {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const ext = extension(name);
  if (ext === '.html' || ext === '.htm') return 'text/html';
  if (ext === '.json') return 'application/json';
  if (ext === '.yaml' || ext === '.yml') return 'application/yaml';
  if (ext === '.csv') return 'text/csv';
  if (ext === '.md' || ext === '.markdown') return 'text/markdown';
  return textualExtensions.has(ext) || looksTextual(bytes) ? 'text/plain' : 'application/octet-stream';
}

function looksTextual(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  const sample = bytes.subarray(0, Math.min(bytes.length, 8_192));
  let controls = 0;
  for (const byte of sample) if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) controls += 1;
  return sample.length === 0 || controls / sample.length < 0.01;
}

function decode(bytes: Buffer): string {
  if (!looksTextual(bytes)) throw new ExecutionSourceError('BINARY_UNSUPPORTED', 'Binary execution source is unsupported');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n');
  } catch {
    throw new ExecutionSourceError('INVALID_ENCODING', 'Execution source must be valid UTF-8');
  }
}

function sanitizeHtml(value: string): { text: string; warnings: string[] } {
  const withoutActive = value
    .replace(/<(script|style|iframe|object|embed|svg|math|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|link|meta|base|img|video|audio|source)\b[^>]*\/?>/gi, '')
    .replace(/\s(?:on\w+|src|href|xlink:href|action|formaction)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  const text = withoutActive
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, warnings: withoutActive === value ? [] : ['Active HTML content and resource references were removed'] };
}

function extract(bytes: Buffer, name: string): Omit<ExecutionSourceSnapshot, 'id' | 'name' | 'byteSize' | 'contentDigest'> {
  const mediaType = detect(bytes, name);
  const ext = extension(name);
  if ((ext === '.pdf' || ext === '.docx' || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff'].includes(ext))
    && mediaType !== 'application/pdf' && !mediaType.includes('wordprocessingml') && !mediaType.startsWith('image/')) {
    throw new ExecutionSourceError('SOURCE_CHANGED', `${name} content does not match its declared rich format`);
  }
  if (mediaType === 'application/pdf' || mediaType.includes('wordprocessingml') || mediaType.startsWith('image/')) {
    throw new ExecutionSourceError('UNSUPPORTED_SOURCE', `${name} is unsupported: no safe extractor is installed`);
  }
  if (mediaType === 'application/octet-stream') throw new ExecutionSourceError('BINARY_UNSUPPORTED', `${name} is binary and unsupported`);
  const decoded = decode(bytes);
  try {
    if (mediaType === 'application/json') JSON.parse(decoded);
  } catch (error) {
    throw new ExecutionSourceError('MALFORMED_SOURCE', `${name} is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const normalized = mediaType === 'text/html' ? sanitizeHtml(decoded) : { text: decoded, warnings: [] };
  return { mediaType, extractionStatus: 'READY', extractedText: normalized.text, extractionWarnings: normalized.warnings };
}

function freezeSources(sources: ExecutionSourceSnapshot[]): readonly ExecutionSourceSnapshot[] {
  return Object.freeze(sources.map((source) => Object.freeze({ ...source, extractionWarnings: Object.freeze([...source.extractionWarnings]) })));
}

function pathRepresentations(exactPath: string, canonicalPath: string): string[] {
  const representations = new Set([exactPath, canonicalPath]);
  for (const path of [...representations]) {
    if (path.startsWith('/private/var/')) representations.add(path.slice('/private'.length));
    else if (path.startsWith('/var/')) representations.add(`/private${path}`);
  }
  return [...representations];
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function validStoredSource(value: unknown): value is ExecutionSourceSnapshot & { extractedText: string; extractedTextDigest: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return typeof source.id === 'string' && source.id.length > 0
    && typeof source.name === 'string' && source.name.length > 0
    && typeof source.mediaType === 'string' && source.mediaType.length > 0
    && Number.isInteger(source.byteSize) && (source.byteSize as number) >= 0
    && validDigest(source.contentDigest)
    && validDigest(source.extractedTextDigest)
    && source.extractionStatus === 'READY'
    && typeof source.extractedText === 'string'
    && Array.isArray(source.extractionWarnings)
    && source.extractionWarnings.every((warning) => typeof warning === 'string');
}

function validLegacyStoredSource(value: unknown): value is ExecutionSourceSnapshot & { extractedText: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return typeof source.id === 'string' && source.id.length > 0
    && typeof source.name === 'string' && source.name.length > 0
    && typeof source.mediaType === 'string' && source.mediaType.length > 0
    && Number.isInteger(source.byteSize) && (source.byteSize as number) >= 0
    && validDigest(source.contentDigest)
    && source.extractedTextDigest === undefined
    && source.extractionStatus === 'READY'
    && typeof source.extractedText === 'string'
    && Array.isArray(source.extractionWarnings)
    && source.extractionWarnings.every((warning) => typeof warning === 'string');
}

function sameMetadata(
  stored: ExecutionSourceSnapshot,
  expected: Omit<ExecutionSourceSnapshot, 'extractedText'>
): boolean {
  return stored.id === expected.id
    && stored.name === expected.name
    && stored.mediaType === expected.mediaType
    && stored.byteSize === expected.byteSize
    && stored.contentDigest === expected.contentDigest
    && stored.extractedTextDigest === expected.extractedTextDigest
    && stored.extractionStatus === expected.extractionStatus
    && JSON.stringify(stored.extractionWarnings) === JSON.stringify(expected.extractionWarnings);
}

function sameLegacyMetadata(
  stored: ExecutionSourceSnapshot,
  expected: Omit<ExecutionSourceSnapshot, 'extractedText'>
): boolean {
  return stored.id === expected.id
    && stored.name === expected.name
    && stored.mediaType === expected.mediaType
    && stored.byteSize === expected.byteSize
    && stored.contentDigest === expected.contentDigest
    && stored.extractionStatus === expected.extractionStatus
    && JSON.stringify(stored.extractionWarnings) === JSON.stringify(expected.extractionWarnings);
}

export function createExecutionSourceRegistry(options: RegistryOptions) {
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const limits = Object.freeze({ ...EXECUTION_SOURCE_LIMITS, ...options.limits });
  const readBytes = options.readBytes;
  const readTimeoutMs = options.readTimeoutMs ?? 15_000;
  const removeDir = options.removeDir ?? ((path: string) => rm(path, { recursive: true, force: true }));
  const capabilities = new Map<string, Capability>();
  const consumedCapabilities = new Set<string>();

  function pruneCapabilities(): void {
    const timestamp = now();
    for (const [capabilityId, capability] of capabilities) {
      if (capability.used || capability.expiresAt < timestamp) capabilities.delete(capabilityId);
    }
  }

  async function boundedRead(path: string): Promise<Buffer> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        readBytes ? readBytes(path) : readDescriptorBounded(path, limits.maxFileBytes),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new ExecutionSourceError('EXTRACTION_TIMEOUT', 'Execution source read timed out')), readTimeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function readDescriptorBounded(path: string, maxBytes: number): Promise<Buffer> {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new ExecutionSourceError('NOT_REGULAR_FILE', 'Execution source must be a regular file');
      return await readHandleBounded(handle, info.size, path, maxBytes);
    } finally {
      await handle.close();
    }
  }

  async function readHandleBounded(handle: Awaited<ReturnType<typeof open>>, size: number, path: string, maxBytes: number): Promise<Buffer> {
      if (size > maxBytes) throw new ExecutionSourceError('SOURCE_TOO_LARGE', `${basename(path)} exceeds per-file limit`);
      const buffer = Buffer.alloc(Math.min(maxBytes + 1, size + 1));
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset > maxBytes) throw new ExecutionSourceError('SOURCE_TOO_LARGE', `${basename(path)} exceeds per-file limit`);
      return buffer.subarray(0, offset);
  }

  async function readSnapshotBounded(contentRef: string): Promise<Buffer> {
    const root = await realpath(options.rootDir);
    const target = confinedSnapshotPath(contentRef);
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new ExecutionSourceError('SOURCE_NOT_FOUND', 'Execution source snapshot is unavailable');
      if (info.size > limits.maxSerializedSnapshotBytes) {
        throw new ExecutionSourceError('SERIALIZED_SNAPSHOT_TOO_LARGE', 'Serialized execution source snapshot exceeds limit');
      }
      const canonicalTarget = await realpath(target);
      const targetRelative = relative(root, canonicalTarget);
      if (!targetRelative || targetRelative.startsWith(`..${sep}`) || targetRelative === '..' || isAbsolute(targetRelative)) {
        throw new ExecutionSourceError('INVALID_CONTENT_REF', 'Execution source content reference is invalid');
      }
      const canonicalInfo = await stat(canonicalTarget);
      if (canonicalInfo.dev !== info.dev || canonicalInfo.ino !== info.ino || !canonicalInfo.isFile()) {
        throw new ExecutionSourceError('SOURCE_CHANGED', 'Execution source snapshot changed during read');
      }
      return await readHandleBounded(handle, info.size, target, limits.maxSerializedSnapshotBytes);
    } finally {
      await handle.close();
    }
  }

  async function issue(input: { windowId: number; projectId: string; paths: string[] }): Promise<ExecutionSourceCapabilityView[]> {
    pruneCapabilities();
    if (input.paths.length > limits.maxFiles) throw new ExecutionSourceError('TOO_MANY_SOURCES', `Select at most ${limits.maxFiles} execution sources`);
    const canonical: Array<{ exactPath: string; canonicalPath: string; representations: string[] }> = [];
    for (const exactPath of input.paths) {
      let real: string;
      try { real = await realpath(exactPath); } catch { throw new ExecutionSourceError('SOURCE_CHANGED', 'Selected execution source is unavailable'); }
      if (canonical.some(({ canonicalPath }) => canonicalPath === real)) throw new ExecutionSourceError('DUPLICATE_SOURCE', 'Duplicate execution source selected');
      canonical.push({ exactPath, canonicalPath: real, representations: pathRepresentations(exactPath, real) });
    }
    const views: ExecutionSourceCapabilityView[] = [];
    const createdIds: string[] = [];
    let total = 0;
    try { for (const { exactPath, canonicalPath: path, representations } of canonical) {
      const existing = [...capabilities.values()].find((capability) =>
        !capability.used
        && capability.windowId === input.windowId
        && capability.projectId === input.projectId
        && capability.path === path
      );
      if (existing) {
        existing.representations = [...new Set([...existing.representations, ...representations])];
        views.push({ id: existing.id, name: existing.name, byteSize: existing.byteSize, expiresAt: existing.expiresAt });
        continue;
      }
      if (capabilities.size >= limits.maxOutstandingCapabilities) {
        throw new ExecutionSourceError('TOO_MANY_SOURCES', 'Too many outstanding execution source capabilities');
      }
      const info = await stat(path);
      if (!info.isFile()) throw new ExecutionSourceError('NOT_REGULAR_FILE', 'Execution source must be a regular file');
      if (info.size > limits.maxFileBytes) throw new ExecutionSourceError('SOURCE_TOO_LARGE', `${basename(path)} exceeds per-file limit`);
      total += info.size;
      if (total > limits.maxTotalBytes) throw new ExecutionSourceError('TOTAL_SOURCE_TOO_LARGE', 'Execution sources exceed total byte limit');
      const bytes = await boundedRead(path);
      if (bytes.byteLength > limits.maxFileBytes) throw new ExecutionSourceError('SOURCE_TOO_LARGE', `${basename(path)} exceeds per-file limit`);
      const issuedAt = now();
      const capability: Capability = {
        id: id(), windowId: input.windowId, projectId: input.projectId, path, exactPath, representations, name: basename(path),
        byteSize: bytes.byteLength, digest: digest(bytes), issuedAt, expiresAt: issuedAt + ttlMs, used: false
      };
      capabilities.set(capability.id, capability);
      createdIds.push(capability.id);
      views.push({ id: capability.id, name: capability.name, byteSize: capability.byteSize, expiresAt: capability.expiresAt });
    } return views; } catch (error) {
      for (const capabilityId of createdIds) capabilities.delete(capabilityId);
      throw error;
    }
  }

  async function resolve(input: { windowId: number; projectId: string; capabilityIds: string[]; snapshotKey: string }): Promise<{
    sources: readonly ExecutionSourceSnapshot[];
    contentRef: string;
    pathDescriptors: readonly ExecutionSourcePathDescriptor[];
  }> {
    if (input.capabilityIds.length > limits.maxFiles) throw new ExecutionSourceError('TOO_MANY_SOURCES', `Use at most ${limits.maxFiles} execution sources`);
    if (new Set(input.capabilityIds).size !== input.capabilityIds.length) throw new ExecutionSourceError('DUPLICATE_SOURCE', 'Duplicate execution source capability');
    const selected = input.capabilityIds.map((capabilityId) => {
      const capability = capabilities.get(capabilityId);
      if (!capability) throw new ExecutionSourceError(consumedCapabilities.has(capabilityId) ? 'REPLAYED_CAPABILITY' : 'INVALID_CAPABILITY', 'Execution source capability is invalid');
      if (capability.windowId !== input.windowId || capability.projectId !== input.projectId) throw new ExecutionSourceError('FOREIGN_CAPABILITY', 'Execution source capability belongs to another window or project');
      if (capability.used) throw new ExecutionSourceError('REPLAYED_CAPABILITY', 'Execution source capability was already used');
      if (now() > capability.expiresAt) throw new ExecutionSourceError('EXPIRED_CAPABILITY', 'Execution source capability expired');
      return capability;
    });
    if (new Set(selected.map(({ path }) => path)).size !== selected.length) {
      throw new ExecutionSourceError('DUPLICATE_SOURCE', 'Duplicate execution source selected');
    }
    for (const capability of selected) capability.used = true;
    const sources: ExecutionSourceSnapshot[] = [];
    let total = 0;
    let extracted = 0;
    try { for (const capability of selected) {
      let currentPath: string;
      try { currentPath = await realpath(capability.path); } catch { throw new ExecutionSourceError('SOURCE_CHANGED', `${capability.name} moved or disappeared`); }
      if (currentPath !== capability.path) throw new ExecutionSourceError('SOURCE_CHANGED', `${capability.name} moved after selection`);
      const info = await stat(currentPath);
      if (!info.isFile() || info.size !== capability.byteSize) throw new ExecutionSourceError('SOURCE_CHANGED', `${capability.name} changed after selection`);
      const bytes = await boundedRead(currentPath);
      if (digest(bytes) !== capability.digest) throw new ExecutionSourceError('SOURCE_CHANGED', `${capability.name} changed after selection`);
      total += bytes.byteLength;
      if (bytes.byteLength > limits.maxFileBytes) throw new ExecutionSourceError('SOURCE_TOO_LARGE', `${capability.name} exceeds per-file limit`);
      if (total > limits.maxTotalBytes) throw new ExecutionSourceError('TOTAL_SOURCE_TOO_LARGE', 'Execution sources exceed total byte limit');
      const normalized = extract(bytes, capability.name);
      extracted += Buffer.byteLength(normalized.extractedText ?? '', 'utf8');
      if (extracted > limits.maxExtractedBytes) throw new ExecutionSourceError('EXTRACTED_TEXT_TOO_LARGE', 'Extracted execution source text exceeds limit');
      const extractedText = normalized.extractedText ?? '';
      sources.push({
        id: randomUUID(), name: capability.name, byteSize: bytes.byteLength,
        contentDigest: capability.digest, extractedTextDigest: digest(Buffer.from(extractedText, 'utf8')),
        ...normalized
      });
    }
    const frozen = freezeSources(sources);
    const serializedSnapshot = Buffer.from(JSON.stringify({ version: 2, sources: frozen }));
    if (serializedSnapshot.byteLength > limits.maxSerializedSnapshotBytes) {
      throw new ExecutionSourceError('SERIALIZED_SNAPSHOT_TOO_LARGE', 'Serialized execution source snapshot exceeds limit');
    }
    const relative = `${input.snapshotKey}/sources.json`;
    await snapshotQueue.run(async () => {
      const directory = join(options.rootDir, input.snapshotKey);
      await mkdir(directory, { recursive: true });
      atomicDurableWrite(join(directory, 'sources.json'), serializedSnapshot, { expectedHash: null });
    });
    return {
      sources: frozen,
      contentRef: relative,
      pathDescriptors: Object.freeze(selected.map((capability) => Object.freeze({
        exactPath: capability.exactPath,
        canonicalPath: capability.path,
        representations: Object.freeze([...capability.representations])
      })))
    };
    } finally {
      for (const capability of selected) {
        capabilities.delete(capability.id);
        consumedCapabilities.add(capability.id);
      }
      while (consumedCapabilities.size > limits.maxOutstandingCapabilities) consumedCapabilities.delete(consumedCapabilities.values().next().value!);
    }
  }

  function confinedSnapshotPath(contentRef: string): string {
    if (typeof contentRef !== 'string' || !contentRef || isAbsolute(contentRef) || normalize(contentRef).split(/[\\/]/).includes('..')) {
      throw new ExecutionSourceError('INVALID_CONTENT_REF', 'Execution source content reference is invalid');
    }
    const root = resolvePath(options.rootDir);
    const target = resolvePath(root, contentRef);
    if (relative(root, target).startsWith('..') || relative(root, target) === '') throw new ExecutionSourceError('INVALID_CONTENT_REF', 'Execution source content reference is invalid');
    return target;
  }

  async function snapshot(
    contentRef: string,
    expectedSources?: ReadonlyArray<Omit<ExecutionSourceSnapshot, 'extractedText'>>,
    persistUpgrade?: (sources: Array<Omit<ExecutionSourceSnapshot, 'extractedText'>>) => Promise<void>
  ): Promise<{ sources: ExecutionSourceSnapshot[] }> {
    try {
      const bytes = await readSnapshotBounded(contentRef);
      const parsed = JSON.parse(bytes.toString('utf8')) as { version?: unknown; sources?: unknown };
      if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.sources) || parsed.sources.length > limits.maxFiles) {
        throw new Error('invalid shape');
      }
      const legacy = parsed.version === 1;
      if (!(legacy ? parsed.sources.every(validLegacyStoredSource) : parsed.sources.every(validStoredSource))) throw new Error('invalid shape');
      const sources = parsed.sources as Array<ExecutionSourceSnapshot & { extractedText: string }>;
      let extractedBytes = 0;
      for (const [index, source] of sources.entries()) {
        const textBytes = Buffer.from(source.extractedText, 'utf8');
        extractedBytes += textBytes.byteLength;
        const textDigest = digest(textBytes);
        const trustedDigest = legacy ? expectedSources?.[index]?.extractedTextDigest ?? source.contentDigest : source.extractedTextDigest;
        if (extractedBytes > limits.maxExtractedBytes || textDigest !== trustedDigest) {
          throw new ExecutionSourceError('SOURCE_CHANGED', 'Execution source snapshot integrity check failed');
        }
      }
      if (legacy && !expectedSources || expectedSources && (sources.length !== expectedSources.length
        || sources.some((source, index) => legacy ? !sameLegacyMetadata(source, expectedSources[index]) : !sameMetadata(source, expectedSources[index])))) {
        throw new ExecutionSourceError('SOURCE_CHANGED', 'Execution source snapshot metadata changed');
      }
      if (legacy) {
        if (!persistUpgrade) throw new ExecutionSourceError('SOURCE_CHANGED', 'Legacy execution source snapshot requires durable metadata upgrade');
        const upgradedMetadata = sources.map(({ extractedText, ...metadata }) => ({
          ...metadata,
          extractedTextDigest: digest(Buffer.from(extractedText, 'utf8'))
        }));
        await persistUpgrade(upgradedMetadata);
        const upgradedSources = sources.map((source, index) => ({ ...source, extractedTextDigest: upgradedMetadata[index].extractedTextDigest }));
        const serialized = Buffer.from(JSON.stringify({ version: 2, sources: upgradedSources }));
        if (serialized.byteLength > limits.maxSerializedSnapshotBytes) throw new ExecutionSourceError('SERIALIZED_SNAPSHOT_TOO_LARGE', 'Serialized execution source snapshot exceeds limit');
        await snapshotQueue.run(async () => {
          atomicDurableWrite(confinedSnapshotPath(contentRef), serialized, { expectedHash: createHash('sha256').update(bytes).digest('hex') });
        });
        return { sources: upgradedSources };
      }
      return { sources };
    } catch (error) {
      if (error instanceof ExecutionSourceError) throw error;
      throw new ExecutionSourceError('SOURCE_NOT_FOUND', 'Execution source snapshot is unavailable');
    }
  }

  async function list(contentRef: string, page: { offset?: number; limit?: number } = {}, expectedSources?: ReadonlyArray<Omit<ExecutionSourceSnapshot, 'extractedText'>>, persistUpgrade?: (sources: Array<Omit<ExecutionSourceSnapshot, 'extractedText'>>) => Promise<void>) {
    const stored = await snapshot(contentRef, expectedSources, persistUpgrade);
    const offset = Math.max(0, page.offset ?? 0);
    const limit = Math.max(1, Math.min(page.limit ?? 16, 16));
    const sources = stored.sources.slice(offset, offset + limit).map(({ extractedText: _content, ...metadata }) => metadata);
    return { sources, ...(offset + sources.length < stored.sources.length ? { nextOffset: offset + sources.length } : {}) };
  }

  async function read(contentRef: string, sourceId: string, page: { offset?: number; maxBytes?: number } = {}, expectedSources?: ReadonlyArray<Omit<ExecutionSourceSnapshot, 'extractedText'>>, persistUpgrade?: (sources: Array<Omit<ExecutionSourceSnapshot, 'extractedText'>>) => Promise<void>) {
    const stored = await snapshot(contentRef, expectedSources, persistUpgrade);
    const source = stored.sources.find((candidate) => candidate.id === sourceId);
    if (!source || source.extractedText === undefined) throw new ExecutionSourceError('SOURCE_NOT_FOUND', 'Execution source is unavailable');
    const bytes = Buffer.from(source.extractedText, 'utf8');
    const offset = Math.max(0, Math.min(page.offset ?? 0, bytes.length));
    const maxBytes = Math.max(1, Math.min(page.maxBytes ?? 32 * 1024, 64 * 1024));
    let end = Math.min(bytes.length, offset + maxBytes);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end += 1;
    return { content: bytes.subarray(offset, end).toString('utf8'), ...(end < bytes.length ? { nextOffset: end } : {}), totalBytes: bytes.length };
  }

  async function pruneSnapshots(liveContentRefs: ReadonlySet<string>, maxAgeMs: number): Promise<void> {
    const live = new Set([...liveContentRefs].map(confinedSnapshotPath));
    let entries;
    try { entries = await readdir(options.rootDir, { withFileTypes: true }); } catch { return; }
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const snapshotPath = join(options.rootDir, entry.name, 'sources.json');
      if (live.has(snapshotPath)) return;
      try {
        const info = await stat(snapshotPath);
        if (now() - info.mtimeMs >= maxAgeMs) await removeDir(join(options.rootDir, entry.name));
      } catch {
        // Missing/malformed orphan and cleanup failures are best effort.
      }
    }));
  }

  async function removeSnapshot(contentRef: string): Promise<void> {
    const target = confinedSnapshotPath(contentRef);
    await rm(join(target, '..'), { recursive: true, force: true });
  }

  return { issue, resolve, list, read, pruneSnapshots, removeSnapshot };
}
