import { isAbsolute, relative, resolve } from 'node:path';

export const MAX_EDITABLE_BYTES = 8 * 1024 * 1024;

export function confineToRoot(root, candidate) {
  const absRoot = resolve(root);
  const abs = resolve(absRoot, candidate);
  const rel = relative(absRoot, abs);
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
    throw new Error('path is not inside the project');
  }
  return abs;
}

export function isBinaryBuffer(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  return sample.includes(0);
}

export function parseFileSource(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('expected a file source');
  }
  const record = /** @type {Record<string, unknown>} */ (input);
  const path = typeof record.path === 'string' ? record.path.trim() : '';
  if (!path) throw new Error('path is required');
  const source = record.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('source is required');
  }
  const src = /** @type {Record<string, unknown>} */ (source);
  const kind = src.kind;
  if (kind !== 'workspace' && kind !== 'host' && kind !== 'thread-storage') {
    throw new Error('unsupported file source');
  }
  return {
    path,
    source: {
      kind,
      threadId: typeof src.threadId === 'string' ? src.threadId : null,
      environmentId: typeof src.environmentId === 'string' ? src.environmentId : null,
      projectId: typeof src.projectId === 'string' ? src.projectId : null
    },
    content: typeof record.content === 'string' ? record.content : undefined,
    expectedSha256: typeof record.expectedSha256 === 'string' ? record.expectedSha256 : null
  };
}
