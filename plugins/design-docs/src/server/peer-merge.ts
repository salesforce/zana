import { canonicalPeerHash, validateDocumentClosure, PeerProtocolError, type PeerDocumentClosure } from '../shared/peer-contract.js';
import { MAX_PEER_HISTORY_ROWS } from '../shared/peer-limits.js';

/** Preserve every branch's causal order, even when common UI rows were pruned. */
export function mergeHistory(histories: PeerDocumentClosure['history'][], preferred?: PeerDocumentClosure['history']): PeerDocumentClosure['history'] {
  const rows = new Map<string, PeerDocumentClosure['history'][number]>(), children = new Map<string, Set<string>>(), incoming = new Map<string, number>();
  for (const history of histories) {
    let previous: string | undefined;
    for (const row of history) {
      const existing = rows.get(row.sync_id);
      if (existing && canonicalPeerHash(existing) !== canonicalPeerHash(row)) throw new PeerProtocolError('conflict', `history identity ${row.sync_id}`);
      rows.set(row.sync_id, row);
      if (rows.size > MAX_PEER_HISTORY_ROWS) throw new PeerProtocolError('limit', 'merged history exceeds row limit');
      if (!incoming.has(row.sync_id)) incoming.set(row.sync_id, 0);
      if (previous && previous !== row.sync_id) {
        const next = children.get(previous) ?? new Set<string>();
        if (!next.has(row.sync_id)) { next.add(row.sync_id); incoming.set(row.sync_id, incoming.get(row.sync_id)! + 1); }
        children.set(previous, next);
      }
      previous = row.sync_id;
    }
  }
  let pending = [...rows.keys()].filter((id) => incoming.get(id) === 0);
  const result: PeerDocumentClosure['history'] = [];
  while (pending.length) {
    const next: string[] = [];
    // Concurrent rows need replica-independent order, not local-first insertion order.
    for (const id of pending.sort()) {
      result.push(rows.get(id)!);
      for (const child of children.get(id) ?? []) {
        incoming.set(child, incoming.get(child)! - 1);
        if (incoming.get(child) === 0) next.push(child);
      }
    }
    pending = next;
  }
  if (result.length !== rows.size) {
    if (!preferred) throw new PeerProtocolError('conflict', 'history causal order conflict');
    // Explicit branch selection can recover prior contradictory linearizations.
    // Keep every immutable snapshot, with the selected branch's order authoritative.
    return [...new Map([...preferred, ...histories.flat()].map((row) => [row.sync_id, row])).values()];
  }
  return result;
}

export interface DocumentMergeResult {
  candidate: PeerDocumentClosure | null;
  conflicts: string[];
}

/** Pure candidate generation. Committing a candidate requires a separate head CAS. */
export function mergeDocument(base: PeerDocumentClosure, local: PeerDocumentClosure, remote: PeerDocumentClosure): DocumentMergeResult {
  const conflicts: string[] = [];
  const equal = (left: unknown, right: unknown) => left === undefined || right === undefined
    ? left === right : canonicalPeerHash(left) === canonicalPeerHash(right);
  const choose = <T>(before: T, left: T, right: T, label: string): T => {
    if (equal(left, right) || equal(right, before)) return left;
    if (equal(left, before)) return right;
    conflicts.push(label);
    return left;
  };
  const doc = { ...local.doc };
  for (const key of ['id', 'slug', 'created_at', 'created_by'] as const) {
    if (!equal(base.doc[key], local.doc[key]) || !equal(base.doc[key], remote.doc[key])) conflicts.push(`document identity ${key}`);
  }
  for (const key of ['title', 'summary', 'status', 'project_id', 'tags', 'entry_path'] as const) {
    Object.assign(doc, { [key]: choose(base.doc[key], local.doc[key], remote.doc[key], `metadata ${key}`) });
  }
  const files: PeerDocumentClosure['files'] = [];
  const fileMaps = [base, local, remote].map((value) => new Map(value.files.map((file) => [file.sync_id, file])));
  const semanticFile = (file: PeerDocumentClosure['files'][number] | undefined) => file &&
    { sync_id: file.sync_id, path: file.path, content: file.content, encoding: file.encoding, size: file.size };
  const fileIds = new Set(fileMaps.flatMap((map) => [...map.keys()]));
  for (const id of fileIds) {
    const [before, left, right] = fileMaps.map((map) => map.get(id));
    if (equal(semanticFile(left), semanticFile(right)) || equal(semanticFile(right), semanticFile(before))) {
      if (left) files.push(left);
    } else if (equal(semanticFile(left), semanticFile(before))) {
      if (right) files.push(right);
    } else if (before && left && right && before.encoding === 'utf8' && left.encoding === 'utf8' && right.encoding === 'utf8' &&
      before.path === left.path && before.path === right.path) {
      const result = mergeText(before.content, left.content, right.content);
      if (result.content === null) conflicts.push(`file ${left.path}: overlapping text edits`);
      else files.push({ ...left, content: result.content, size: Buffer.byteLength(result.content, 'utf8') });
    } else conflicts.push(`file ${before?.path ?? left?.path ?? right!.path}: incompatible identity, rename, deletion or binary edit`);
  }
  const mergeRows = <T>(rows: readonly T[][], identity: (row: T) => string, label: string): T[] => {
    const maps = rows.map((rows) => new Map(rows.map((row) => [identity(row), row])));
    const ids = new Set(maps.flatMap((map) => [...map.keys()]));
    const result: T[] = [];
    for (const id of ids) {
      const [before, left, right] = maps.map((map) => map.get(id));
      const merged = choose(before, left, right, `${label} ${id}`);
      if (merged !== undefined) result.push(merged);
    }
    return result;
  };
  let history: PeerDocumentClosure['history'] = [];
  try { history = mergeHistory([base.history, local.history, remote.history]); }
  catch (error) { conflicts.push(error instanceof Error ? error.message : 'invalid merged history'); }
  const candidate = { doc, files: files.sort((a, b) => a.path.localeCompare(b.path)), history,
    comments: mergeRows([base.comments, local.comments, remote.comments], (row) => row.id, 'comment').sort((a, b) => a.id.localeCompare(b.id)),
    threads: mergeRows([base.threads, local.threads, remote.threads], (row) => row.thread_id, 'thread').sort((a, b) => a.thread_id.localeCompare(b.thread_id)) };
  if (conflicts.length) return { candidate: null, conflicts };
  try { return { candidate: validateDocumentClosure(candidate), conflicts: [] }; }
  catch (error) { return { candidate: null, conflicts: [error instanceof Error ? error.message : 'invalid merged document'] }; }
}

export interface TextMergeResult {
  content: string | null;
  conflicts: string[];
}

/**
 * Accept only independently changed line ranges. Ambiguous overlap remains a
 * visible fork rather than guessing at author intent.
 */
export function mergeText(base: string, local: string, remote: string): TextMergeResult {
  if (local === remote) return { content: local, conflicts: [] };
  if (local === base) return { content: remote, conflicts: [] };
  if (remote === base) return { content: local, conflicts: [] };
  const baseLines = base.split('\n');
  const localRange = changedRange(baseLines, local.split('\n'));
  const remoteRange = changedRange(baseLines, remote.split('\n'));
  if (!localRange || !remoteRange || rangesOverlap(localRange, remoteRange)) {
    return { content: null, conflicts: ['overlapping text edits'] };
  }
  const changes = [
    { range: localRange, lines: local.split('\n') },
    { range: remoteRange, lines: remote.split('\n') }
  ].sort((left, right) => right.range.start - left.range.start);
  const merged = [...baseLines];
  for (const change of changes) {
    const replacement = change.lines.slice(change.range.start, change.lines.length - change.range.suffix);
    merged.splice(change.range.start, change.range.end - change.range.start, ...replacement);
  }
  return { content: merged.join('\n'), conflicts: [] };
}

interface ChangedRange { start: number; end: number; suffix: number }

function changedRange(base: string[], next: string[]): ChangedRange | null {
  let start = 0;
  while (start < base.length && start < next.length && base[start] === next[start]) start += 1;
  let suffix = 0;
  while (
    suffix < base.length - start && suffix < next.length - start &&
    base[base.length - suffix - 1] === next[next.length - suffix - 1]
  ) suffix += 1;
  if (start === base.length && start === next.length) return null;
  return { start, end: base.length - suffix, suffix };
}

function rangesOverlap(left: ChangedRange, right: ChangedRange): boolean {
  if (left.start === left.end || right.start === right.end) return left.start <= right.end && right.start <= left.end;
  return left.start < right.end && right.start < left.end;
}
