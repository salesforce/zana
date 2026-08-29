import { isAbsolute, relative, resolve, sep } from 'node:path';

const MAX_REL_PATH = 1024;

/**
 * Map a renderer-supplied path onto a relative path inside `root`.
 * Rejects escapes, empty paths, and over-long candidates (Rule 2).
 */
export function confinePathToRoot(root: string, candidate: string): string | null {
  if (!root || !candidate || !isAbsolute(root)) return null;
  const resolvedRoot = resolve(root);
  const resolved = isAbsolute(candidate) ? resolve(candidate) : resolve(resolvedRoot, candidate);
  const rel = relative(resolvedRoot, resolved);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  const normalized = rel.split(sep).join('/');
  if (normalized.length > MAX_REL_PATH) return null;
  if (normalized.split('/').some((part) => part === '..')) return null;
  return normalized;
}

export const DEFAULT_TIMELINE_SEGMENT_LIMIT = 10_000;
export const MAX_TIMELINE_SEGMENT_LIMIT = 10_000;

export function parseTimelineSegmentLimit(raw: string | null): number {
  if (!raw) return DEFAULT_TIMELINE_SEGMENT_LIMIT;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_TIMELINE_SEGMENT_LIMIT;
  return Math.min(MAX_TIMELINE_SEGMENT_LIMIT, Math.max(1, Math.floor(value)));
}

export function parsePositiveInt(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (!/^[1-9]\d*$/.test(raw)) return undefined;
  return Number(raw);
}

/** `afterSequence` is a high-water mark and may be `0` on an empty thread. */
export function parseNonNegativeInt(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

export function outlinePreview(text: string, max = 80): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}
