import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve as resolvePath, sep } from 'node:path';
import { atomicDurableWrite, createSerializedTransactionQueue } from '../harness-routing/storage.js';
import { allowedLocationsText, sourceRefusal, type SourcePolicy } from './source-policy.js';
import type { ExecutionSourceCapabilityView, ExecutionSourceSnapshot } from '@zana-ai/zcc-domain/product';

export const EXECUTION_SOURCE_LIMITS = Object.freeze({
  maxFiles: 16,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxExtractedBytes: 8 * 1024 * 1024,
  maxSerializedSnapshotBytes: 9 * 1024 * 1024,
  maxOutstandingCapabilities: 128
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

/**
 * Who may resolve a capability: the trusted window that issued it, or the agent session whose
 * launch issued it. A capability never crosses bindings, whatever ids the caller presents.
 */
export type ExecutionSourceBinding = { kind: 'window'; windowId: number } | { kind: 'session'; sessionId: string };
/** `{ windowId }` is the original window form and stays accepted; `{ binding }` also covers sessions. */
export type ExecutionSourceBindingInput = { windowId: number; binding?: never } | { binding: ExecutionSourceBinding; windowId?: never };

const MAX_SESSION_ID_LENGTH = 256;

/** The binding a caller presented, or undefined when it is malformed or ambiguous. */
function bindingOf(input: { windowId?: unknown; binding?: unknown }): ExecutionSourceBinding | undefined {
  const hasWindow = input.windowId !== undefined;
  if (input.binding === undefined) {
    return hasWindow && Number.isSafeInteger(input.windowId) ? { kind: 'window', windowId: input.windowId as number } : undefined;
  }
  if (hasWindow || !input.binding || typeof input.binding !== 'object') return undefined;
  const binding = input.binding as Record<string, unknown>;
  if (binding.kind === 'window' && Number.isSafeInteger(binding.windowId)) return { kind: 'window', windowId: binding.windowId as number };
  if (binding.kind === 'session' && typeof binding.sessionId === 'string'
    && binding.sessionId.length > 0 && binding.sessionId.length <= MAX_SESSION_ID_LENGTH) {
    return { kind: 'session', sessionId: binding.sessionId };
  }
  return undefined;
}

function requireBinding(input: { windowId?: unknown; binding?: unknown }): ExecutionSourceBinding {
  const binding = bindingOf(input);
  if (!binding) throw new ExecutionSourceError('INVALID_CAPABILITY', 'Execution source binding is invalid');
  return binding;
}

function sameBinding(a: ExecutionSourceBinding, b: ExecutionSourceBinding | undefined): boolean {
  if (!b || a.kind !== b.kind) return false;
  return a.kind === 'window' ? a.windowId === (b as typeof a).windowId : a.sessionId === (b as typeof a).sessionId;
}

interface Capability {
  id: string;
  binding: ExecutionSourceBinding;
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
  /** Issued under a source policy: a renewal keeps refusing hard-linked files. */
  policy: boolean;
}

interface RetiredCapability {
  id: string;
  binding: ExecutionSourceBinding;
  projectId: string;
  path: string;
  exactPath: string;
  representations: string[];
  name: string;
  digest: string;
  policy: boolean;
  retiredAt: number;
}

export type ExecutionSourceDropReason = 'moved' | 'unreadable' | 'too-large' | 'unknown';
export interface ExecutionSourceReissueResult {
  renewed: Array<{ previousId: string; source: ExecutionSourceCapabilityView; changed: boolean }>;
  dropped: Array<{ previousId: string; name?: string; reason: ExecutionSourceDropReason }>;
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
const RETIRED_MAX_AGE_MS = 60 * 60 * 1_000;
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

// Regex-based stripping is acceptable here because the result is only ever used
// as a PLAIN-TEXT extraction digest (`extractedText`) — it is never rendered as
// HTML in a webview or injected into the DOM. It removes active elements and
// resource references defensively, but its correctness contract is "produce
// readable plain text", not "produce safe HTML". Do not repurpose this output as
// sanitized markup for rendering; use a real sanitizer (DOMPurify) if that need
// ever arises.
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

// A snapshot key is a single path segment used to build the on-disk snapshot
// directory. It is renderer/agent-influenced, so it must never contain path
// separators or traversal segments (Rule 2): reject anything that isn't exactly
// one clean segment before it reaches join()/write.
function assertSnapshotKey(key: string): string {
  if (typeof key !== 'string' || !key || key.length > 256 || key === '.' || key === '..'
    || /[\\/]/.test(key) || normalize(key) !== key) {
    throw new ExecutionSourceError('INVALID_CONTENT_REF', 'Execution source snapshot key is invalid');
  }
  return key;
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

  const retired = new Map<string, RetiredCapability>();

  function trimRetired(): void {
    const timestamp = now();
    for (const [retiredId, record] of retired) {
      if (timestamp - record.retiredAt > RETIRED_MAX_AGE_MS) retired.delete(retiredId);
    }
    while (retired.size > limits.maxOutstandingCapabilities) retired.delete(retired.keys().next().value!);
  }

  function retire(capability: Capability): void {
    retired.delete(capability.id);
    retired.set(capability.id, {
      id: capability.id, binding: capability.binding, projectId: capability.projectId, path: capability.path,
      exactPath: capability.exactPath, representations: [...capability.representations], name: capability.name,
      digest: capability.digest, policy: capability.policy, retiredAt: now()
    });
    trimRetired();
  }

  function pruneCapabilities(): void {
    const timestamp = now();
    for (const [capabilityId, capability] of capabilities) {
      if (capability.used || capability.expiresAt < timestamp) {
        if (!capability.used) retire(capability);
        capabilities.delete(capabilityId);
      }
    }
  }

  /** What `issue()` saw when it stat'ed the path: the handle it reads must be that same file. */
  interface IssuedFile { dev: number; ino: number; policy: boolean }

  async function statAndRead(path: string, options: { policy?: boolean; afterStat?: (size: number) => void } = {}): Promise<{ bytes: Buffer; size: number }> {
    const info = await stat(path);
    if (!info.isFile()) throw new ExecutionSourceError('NOT_REGULAR_FILE', 'Execution source must be a regular file');
    // realpath does not resolve hard links, so `ln ~/.ssh/id_rsa ~/notes.md` passes the path policy.
    if (options.policy && info.nlink > 1) throw new ExecutionSourceError('UNSUPPORTED_SOURCE', `${basename(path)} is a hard-linked file`);
    if (info.size > limits.maxFileBytes) throw new ExecutionSourceError('SOURCE_TOO_LARGE', `${basename(path)} exceeds per-file limit`);
    options.afterStat?.(info.size);
    const bytes = await boundedRead(path, { dev: info.dev, ino: info.ino, policy: !!options.policy });
    if (bytes.byteLength > limits.maxFileBytes) throw new ExecutionSourceError('SOURCE_TOO_LARGE', `${basename(path)} exceeds per-file limit`);
    return { bytes, size: info.size };
  }

  async function boundedRead(path: string, issued?: IssuedFile): Promise<Buffer> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        readBytes ? readBytes(path) : readDescriptorBounded(path, limits.maxFileBytes, issued),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new ExecutionSourceError('EXTRACTION_TIMEOUT', 'Execution source read timed out')), readTimeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function readDescriptorBounded(path: string, maxBytes: number, issued?: IssuedFile): Promise<Buffer> {
    // Open once (no-follow) and read via the fd, then re-fstat the SAME handle and
    // compare identity/size — this detects a file swapped or resized underneath us
    // during the read without a second open() that could race a replacement.
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new ExecutionSourceError('NOT_REGULAR_FILE', 'Execution source must be a regular file');
      if (issued) {
        // A file renamed over the path after issue() checked it (`ln ~/.ssh/id_rsa /tmp/x && mv /tmp/x ~/notes.md`)
        // is another inode, and may be a hard link to a secret.
        if (info.dev !== issued.dev || info.ino !== issued.ino) throw new ExecutionSourceError('SOURCE_CHANGED', 'Execution source changed during read');
        if (issued.policy && info.nlink > 1) throw new ExecutionSourceError('UNSUPPORTED_SOURCE', `${basename(path)} is a hard-linked file`);
      }
      // `path` is canonical, so the handle must be the file it names now: a folder on the
      // way swapped for a symlink after the realpath check would have opened another inode.
      // Without openat this narrows the race rather than closing it.
      let canonical: Awaited<ReturnType<typeof stat>> | undefined;
      try { canonical = (await realpath(path)) === path ? await stat(path) : undefined; } catch { canonical = undefined; }
      if (!canonical || canonical.dev !== info.dev || canonical.ino !== info.ino) {
        throw new ExecutionSourceError('SOURCE_CHANGED', 'Execution source changed during read');
      }
      const bytes = await readHandleBounded(handle, info.size, path, maxBytes);
      const after = await handle.stat();
      if (after.dev !== info.dev || after.ino !== info.ino || after.size !== info.size || !after.isFile()) {
        throw new ExecutionSourceError('SOURCE_CHANGED', 'Execution source changed during read');
      }
      return bytes;
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

  /**
   * `policy` (optional) confines every source to its allowed folders and refuses its protected
   * ones, checked against the realpath taken here. `resolve` later requires the same realpath,
   * so a symlink swapped in after this check cannot redirect the capability elsewhere. Picker
   * selections pass no policy: the user chose the file. A session binding has no user choice
   * behind it, so it must carry a policy.
   */
  async function issue(input: ExecutionSourceBindingInput & { projectId: string; paths: string[]; policy?: SourcePolicy }): Promise<ExecutionSourceCapabilityView[]> {
    const binding = requireBinding(input);
    if (binding.kind === 'session' && !input.policy) {
      throw new ExecutionSourceError('INVALID_CAPABILITY', 'Session execution sources require a source policy');
    }
    pruneCapabilities();
    if (input.paths.length > limits.maxFiles) throw new ExecutionSourceError('TOO_MANY_SOURCES', `Select at most ${limits.maxFiles} execution sources`);
    const canonical: Array<{ exactPath: string; canonicalPath: string; representations: string[] }> = [];
    for (const exactPath of input.paths) {
      let real: string;
      try { real = await realpath(exactPath); } catch { throw new ExecutionSourceError('SOURCE_CHANGED', 'Selected execution source is unavailable'); }
      // The link walk covers the path as given (a link into a protected file resolves to an allowed realpath).
      const refusal = input.policy ? await sourceRefusal(exactPath, real, input.policy) : undefined;
      if (refusal === 'outside') throw new ExecutionSourceError('UNSUPPORTED_SOURCE', `${basename(real)} is outside ${allowedLocationsText(input.policy)}`);
      if (refusal === 'sensitive') throw new ExecutionSourceError('UNSUPPORTED_SOURCE', `${basename(real)} is in a protected location`);
      if (refusal === 'links') throw new ExecutionSourceError('UNSUPPORTED_SOURCE', `${basename(real)} is reached through too many links`);
      if (canonical.some(({ canonicalPath }) => canonicalPath === real)) throw new ExecutionSourceError('DUPLICATE_SOURCE', 'Duplicate execution source selected');
      canonical.push({ exactPath, canonicalPath: real, representations: pathRepresentations(exactPath, real) });
    }
    const views: ExecutionSourceCapabilityView[] = [];
    const createdIds: string[] = [];
    let total = 0;
    try { for (const { exactPath, canonicalPath: path, representations } of canonical) {
      const existing = [...capabilities.values()].find((capability) =>
        !capability.used
        && sameBinding(capability.binding, binding)
        && capability.projectId === input.projectId
        && capability.path === path
      );
      if (existing) {
        total += existing.byteSize;
        if (total > limits.maxTotalBytes) throw new ExecutionSourceError('TOTAL_SOURCE_TOO_LARGE', 'Execution sources exceed total byte limit');
        existing.representations = [...new Set([...existing.representations, ...representations])];
        views.push({ id: existing.id, name: existing.name, byteSize: existing.byteSize, expiresAt: existing.expiresAt });
        continue;
      }
      if (capabilities.size >= limits.maxOutstandingCapabilities) {
        throw new ExecutionSourceError('TOO_MANY_SOURCES', 'Too many outstanding execution source capabilities');
      }
      const { bytes } = await statAndRead(path, {
        policy: !!input.policy,
        afterStat: (size) => {
          total += size;
          if (total > limits.maxTotalBytes) throw new ExecutionSourceError('TOTAL_SOURCE_TOO_LARGE', 'Execution sources exceed total byte limit');
        }
      });
      const issuedAt = now();
      const capability: Capability = {
        id: id(), binding, projectId: input.projectId, path, exactPath, representations, name: basename(path),
        byteSize: bytes.byteLength, digest: digest(bytes), issuedAt, expiresAt: issuedAt + ttlMs, used: false, policy: !!input.policy
      };
      capabilities.set(capability.id, capability);
      createdIds.push(capability.id);
      views.push({ id: capability.id, name: capability.name, byteSize: capability.byteSize, expiresAt: capability.expiresAt });
    } return views; } catch (error) {
      for (const capabilityId of createdIds) capabilities.delete(capabilityId);
      throw error;
    }
  }

  function viewOf(capability: Capability): ExecutionSourceCapabilityView {
    return { id: capability.id, name: capability.name, byteSize: capability.byteSize, expiresAt: capability.expiresAt };
  }

  /**
   * Gives a fresh capability to each id that `resolve` or expiry retired, when its file is
   * still the one that was selected. An old id is never put back: the composer swaps it for
   * the new one. A failure for one id never stops the others.
   */
  async function reissue(input: ExecutionSourceBindingInput & { projectId: string; capabilityIds: string[] }): Promise<ExecutionSourceReissueResult> {
    if (input.capabilityIds.length > limits.maxFiles) throw new ExecutionSourceError('TOO_MANY_SOURCES', `Use at most ${limits.maxFiles} execution sources`);
    // A malformed binding matches nothing, so every id drops as unknown.
    const binding = bindingOf(input);
    pruneCapabilities();
    trimRetired();
    const result: ExecutionSourceReissueResult = { renewed: [], dropped: [] };
    const findLive = (path: string) => [...capabilities.values()].find((capability) =>
      !capability.used && sameBinding(capability.binding, binding) && capability.projectId === input.projectId && capability.path === path);
    for (const previousId of new Set(input.capabilityIds)) {
      const live = capabilities.get(previousId);
      if (live && !live.used && sameBinding(live.binding, binding) && live.projectId === input.projectId) {
        result.renewed.push({ previousId, source: viewOf(live), changed: false });
        continue;
      }
      const record = retired.get(previousId);
      if (!binding || !record || !sameBinding(record.binding, binding) || record.projectId !== input.projectId) {
        result.dropped.push({ previousId, reason: 'unknown' });
        continue;
      }
      const drop = (reason: ExecutionSourceDropReason) => { result.dropped.push({ previousId, name: record.name, reason }); };
      try {
        let real: string;
        try { real = await realpath(record.path); } catch { drop('moved'); continue; }
        // record.path is the realpath `issue` proved inside the root, so equality keeps it inside.
        if (real !== record.path) { drop('moved'); continue; }
        const existing = findLive(record.path);
        if (existing) {
          existing.representations = [...new Set([...existing.representations, ...record.representations])];
          retired.delete(previousId);
          result.renewed.push({ previousId, source: viewOf(existing), changed: existing.digest !== record.digest });
          continue;
        }
        if (capabilities.size >= limits.maxOutstandingCapabilities) { drop('unreadable'); continue; }
        const { bytes } = await statAndRead(record.path, { policy: record.policy });
        const raced = findLive(record.path);
        if (raced) {
          retired.delete(previousId);
          result.renewed.push({ previousId, source: viewOf(raced), changed: raced.digest !== record.digest });
          continue;
        }
        if (capabilities.size >= limits.maxOutstandingCapabilities) { drop('unreadable'); continue; }
        const issuedAt = now();
        const capability: Capability = {
          id: id(), binding, projectId: input.projectId, path: record.path, exactPath: record.exactPath,
          representations: [...record.representations], name: record.name, byteSize: bytes.byteLength, digest: digest(bytes),
          issuedAt, expiresAt: issuedAt + ttlMs, used: false, policy: record.policy
        };
        capabilities.set(capability.id, capability);
        retired.delete(previousId);
        result.renewed.push({ previousId, source: viewOf(capability), changed: capability.digest !== record.digest });
      } catch (error) {
        const code = error instanceof ExecutionSourceError ? error.code : undefined;
        drop(code === 'NOT_REGULAR_FILE' ? 'moved' : code === 'SOURCE_TOO_LARGE' ? 'too-large' : 'unreadable');
      }
    }
    return result;
  }

  /**
   * Forget the retired records of ids a successful launch consumed, so a replayed id cannot
   * be exchanged for a fresh capability.
   */
  function discardRetired(input: ExecutionSourceBindingInput & { projectId: string; capabilityIds: string[] }): void {
    const binding = bindingOf(input);
    for (const capabilityId of input.capabilityIds) {
      const record = retired.get(capabilityId);
      if (record && sameBinding(record.binding, binding) && record.projectId === input.projectId) retired.delete(capabilityId);
    }
  }

  async function resolve(input: ExecutionSourceBindingInput & { projectId: string; capabilityIds: string[]; snapshotKey: string }): Promise<{
    sources: readonly ExecutionSourceSnapshot[];
    contentRef: string;
    pathDescriptors: readonly ExecutionSourcePathDescriptor[];
  }> {
    const binding = requireBinding(input);
    if (input.capabilityIds.length > limits.maxFiles) throw new ExecutionSourceError('TOO_MANY_SOURCES', `Use at most ${limits.maxFiles} execution sources`);
    if (new Set(input.capabilityIds).size !== input.capabilityIds.length) throw new ExecutionSourceError('DUPLICATE_SOURCE', 'Duplicate execution source capability');
    const selected = input.capabilityIds.map((capabilityId) => {
      const capability = capabilities.get(capabilityId);
      if (!capability) throw new ExecutionSourceError(consumedCapabilities.has(capabilityId) ? 'REPLAYED_CAPABILITY' : 'INVALID_CAPABILITY', 'Execution source capability is invalid');
      if (!sameBinding(capability.binding, binding) || capability.projectId !== input.projectId) throw new ExecutionSourceError('FOREIGN_CAPABILITY', 'Execution source capability belongs to another window, session, or project');
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
    const snapshotKey = assertSnapshotKey(input.snapshotKey);
    const contentRef = `${snapshotKey}/sources.json`;
    const snapshotFile = confinedSnapshotPath(contentRef);
    await snapshotQueue.run(async () => {
      await mkdir(dirname(snapshotFile), { recursive: true });
      atomicDurableWrite(snapshotFile, serializedSnapshot, { expectedHash: null });
    });
    return {
      sources: frozen,
      contentRef,
      pathDescriptors: Object.freeze(selected.map((capability) => Object.freeze({
        exactPath: capability.exactPath,
        canonicalPath: capability.path,
        representations: Object.freeze([...capability.representations])
      })))
    };
    } finally {
      for (const capability of selected) {
        capabilities.delete(capability.id);
        retire(capability);
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
      for (const source of sources) {
        const textBytes = Buffer.from(source.extractedText, 'utf8');
        extractedBytes += textBytes.byteLength;
        if (extractedBytes > limits.maxExtractedBytes) {
          throw new ExecutionSourceError('SOURCE_CHANGED', 'Execution source snapshot integrity check failed');
        }
        // v2 carries a trusted extracted-text digest; verify it. v1 (legacy) has
        // NO trusted extracted-text digest — contentDigest is the RAW-bytes hash,
        // which diverges from the extracted text after transforms (HTML sanitize,
        // CRLF normalize), so it must NOT be used as a fallback. Legacy integrity
        // rests on metadata equality (checked below) plus the fresh digest
        // persisted on upgrade.
        if (!legacy && digest(textBytes) !== source.extractedTextDigest) {
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

  return { issue, reissue, discardRetired, resolve, list, read, pruneSnapshots, removeSnapshot };
}
