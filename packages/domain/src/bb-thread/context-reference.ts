/** Copied snapshots are data. Their source locators never grant access. */
export const MAX_CONTEXT_REFERENCE_TEXT = 100_000;
export const MAX_CONTEXT_REFERENCES = 24;
export const MAX_CONTEXT_REFERENCES_TEXT = 400_000;

export interface ContextReference {
  version: 1;
  label: string;
  text: string;
  /** A new user instruction paired with the captured snapshot. */
  comment?: string;
  source?:
    | { kind: 'file'; path: string; startLine?: number; endLine?: number; projectId?: string; hostId?: string }
    | { kind: 'plugin'; pluginId: string; resourceId: string; path?: string; revision?: string; heading?: string }
    | { kind: 'thread'; threadId: string; messageId: string; sourceSeqEnd: number };
}

export interface PromptTextReference {
  start: number;
  end: number;
  reference: ContextReference;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function label(value: unknown, max: number): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= max && !/[\r\n\0]/.test(value);
}

export function parseContextReference(value: unknown): ContextReference | null {
  const data = record(value);
  if (!data || data.version !== 1 || !label(data.label, 240) || typeof data.text !== 'string'
    || !data.text.length || data.text.length > MAX_CONTEXT_REFERENCE_TEXT) return null;
  const result: ContextReference = { version: 1, label: data.label, text: data.text };
  if (data.comment !== undefined) {
    if (typeof data.comment !== 'string' || data.comment.length > 4000 || data.comment.includes('\0')) return null;
    result.comment = data.comment;
  }
  if (data.source === undefined) return result;
  const source = record(data.source);
  if (!source) return null;
  if (source.kind === 'file') {
    if (!label(source.path, 4096)) return null;
    const hasLines = source.startLine !== undefined || source.endLine !== undefined;
    if (hasLines && (!Number.isSafeInteger(source.startLine) || !Number.isSafeInteger(source.endLine)
      || (source.startLine as number) < 1 || (source.endLine as number) < (source.startLine as number)
      || (source.endLine as number) > 10_000_000)) return null;
    result.source = { kind: 'file', path: source.path, ...(hasLines ? { startLine: source.startLine as number, endLine: source.endLine as number } : {}) };
    for (const key of ['projectId', 'hostId'] as const) {
      if (source[key] !== undefined) {
        if (!label(source[key], 100)) return null;
        result.source[key] = source[key];
      }
    }
  } else if (source.kind === 'plugin') {
    if (!label(source.pluginId, 160) || !/^[a-zA-Z0-9._-]+$/.test(source.pluginId) || !label(source.resourceId, 500)) return null;
    result.source = { kind: 'plugin', pluginId: source.pluginId, resourceId: source.resourceId };
    for (const key of ['path', 'revision', 'heading'] as const) {
      if (source[key] !== undefined) {
        if (!label(source[key], key === 'path' ? 4096 : 500)) return null;
        result.source[key] = source[key];
      }
    }
  } else if (source.kind === 'thread') {
    if (!label(source.threadId, 100) || !label(source.messageId, 500)
      || !Number.isSafeInteger(source.sourceSeqEnd) || (source.sourceSeqEnd as number) < 1) return null;
    result.source = { kind: 'thread', threadId: source.threadId, messageId: source.messageId, sourceSeqEnd: source.sourceSeqEnd as number };
  } else return null;
  return result;
}

export function parseContextReferences(value: unknown): ContextReference[] | null {
  if (!Array.isArray(value) || value.length > MAX_CONTEXT_REFERENCES) return null;
  const refs: ContextReference[] = [];
  let size = 0;
  for (const entry of value) {
    const ref = parseContextReference(entry);
    if (!ref || (size += ref.text.length + (ref.comment?.length ?? 0)) > MAX_CONTEXT_REFERENCES_TEXT) return null;
    refs.push(ref);
  }
  return refs;
}

export function contextReferenceLocation(reference: ContextReference): string {
  const source = reference.source;
  if (!source) return reference.label;
  if (source.kind === 'thread') return `Thread ${source.threadId} / message ${source.sourceSeqEnd}`;
  if (source.kind === 'plugin') return [source.pluginId, source.resourceId, source.path, source.heading].filter(Boolean).join(' / ');
  return source.startLine === undefined ? source.path : `${source.path}:${source.startLine}–${source.endLine}`;
}

/** The same serializer is used when sending and when validating recorded offsets. */
export function contextReferencePrompt(reference: ContextReference): string {
  let length = 3;
  for (const match of reference.text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  return `\n\n${reference.label} — ${contextReferenceLocation(reference)} (copied selection)\n${fence}\n${reference.text}\n${fence}\n${reference.comment ? `\nUser comment:\n${reference.comment}\n` : ''}\n`;
}

/** Invalid metadata must never hide or replace ordinary message text. */
export function validPromptReferences(text: string, value: unknown): PromptTextReference[] {
  if (!Array.isArray(value) || value.length > MAX_CONTEXT_REFERENCES || value.some(entry => !record(entry))) return [];
  const refs: PromptTextReference[] = [];
  let end = 0;
  let size = 0;
  for (const entry of [...value].sort((a, b) => a.start - b.start)) {
    const reference = parseContextReference(entry.reference);
    if (!reference || !Number.isSafeInteger(entry.start) || !Number.isSafeInteger(entry.end)
      || entry.start < end || entry.end <= entry.start || entry.end > text.length
      || text.slice(entry.start, entry.end) !== contextReferencePrompt(reference)
      || (size += reference.text.length + (reference.comment?.length ?? 0)) > MAX_CONTEXT_REFERENCES_TEXT) return [];
    refs.push({ start: entry.start, end: entry.end, reference });
    end = entry.end;
  }
  return refs;
}

/** Plain-text editing keeps metadata only for unchanged, unambiguous snapshot blocks. */
export function relocatePromptReferences(previousText: string, value: unknown, text: string): PromptTextReference[] {
  const references = validPromptReferences(previousText, value);
  const result: PromptTextReference[] = [];
  let cursor = 0;
  for (const item of references) {
    const block = contextReferencePrompt(item.reference);
    const start = text.indexOf(block, cursor);
    if (start < 0) continue;
    // Repeated identical blocks have no stable identity after arbitrary plain-text edits.
    if (text.indexOf(block, start + block.length) >= 0) continue;
    result.push({ ...item, start, end: start + block.length });
    cursor = start + block.length;
  }
  return result;
}
