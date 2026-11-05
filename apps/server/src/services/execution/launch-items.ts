import { createHash } from 'node:crypto';

/**
 * One validation owner for everything a launch carries as source content: path sources and
 * agent-supplied attachments share the per-launch item budget, and attachments get safe,
 * unique names. Path sources keep their names and are never deduplicated or renamed.
 */
export const LAUNCH_ITEM_LIMITS = Object.freeze({
  maxItems: 16,
  maxItemBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxNameBytes: 128
});

export type LaunchItemErrorCode = 'INVALID_NAME' | 'NAME_TOO_LONG' | 'TOO_MANY_ITEMS' | 'ITEM_TOO_LARGE' | 'TOTAL_TOO_LARGE';

export interface LaunchItemInput {
  kind: 'source' | 'attachment';
  name: string;
  byteSize: number;
  sha256: string;
}

export interface LaunchItemMapping {
  /** Position of the item in the input list. */
  index: number;
  given: string;
  used: string;
  /** Name of the kept item this one was folded into (same name, same content). */
  deduplicated?: string;
}

export type LaunchItemsResult =
  | { ok: true; kept: Array<{ index: number; name: string }>; mapping: LaunchItemMapping[] }
  | { ok: false; code: LaunchItemErrorCode; message: string };

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Characters Windows rejects in a file name; `:` also opens an alternate data stream. */
const WINDOWS_INVALID = /[<>:"|?*]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

const fail = (code: LaunchItemErrorCode, message: string): LaunchItemsResult => ({ ok: false, code, message });
const clashKey = (name: string): string => name.normalize('NFC').toLowerCase();

/** The reason an attachment name is unsafe, or undefined. Unsafe names are rejected, never rewritten. */
export function attachmentNameProblem(name: string): string | undefined {
  if (typeof name !== 'string' || name.length === 0) return 'is empty';
  if (name.includes('\0')) return 'contains a NUL character';
  if (CONTROL_CHARS.test(name)) return 'contains a control character';
  if (name.includes('/') || name.includes('\\')) return 'contains a path separator';
  if (WINDOWS_INVALID.test(name)) return 'contains a character Windows does not allow (< > : " | ? *)';
  if (name.startsWith('.')) return 'starts with a dot';
  if (name.endsWith('.') || name.endsWith(' ')) return 'ends with a dot or space';
  if (WINDOWS_RESERVED.test(name.split('.')[0]!)) return 'is a reserved name';
  if (Buffer.byteLength(name, 'utf8') > LAUNCH_ITEM_LIMITS.maxNameBytes) return `is longer than ${LAUNCH_ITEM_LIMITS.maxNameBytes} bytes`;
  return undefined;
}

/** `name (n).ext` for the first n starting at 1 whose result is unused. Undefined if a result outgrows the name limit. */
function suffixed(name: string, taken: ReadonlySet<string>): string | undefined {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; ; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (Buffer.byteLength(candidate, 'utf8') > LAUNCH_ITEM_LIMITS.maxNameBytes) return undefined;
    if (!taken.has(clashKey(candidate))) return candidate;
  }
}

/**
 * Validate one launch's items in order. Sources are kept as they are and reserve their names.
 * Each attachment is checked for an unsafe name, then clashes (case-insensitive, NFC): the same
 * name with the same content folds into the kept item; the same name with different content
 * gets ` (1)`, ` (2)`. Every kept item counts toward the item, per-item and total budget.
 */
export function validateLaunchItems(items: readonly LaunchItemInput[]): LaunchItemsResult {
  const limits = LAUNCH_ITEM_LIMITS;
  const taken = new Map<string, { name: string; sha256: string }>();
  const kept: Array<{ index: number; name: string }> = [];
  const mapping: LaunchItemMapping[] = [];
  let total = 0;
  // Sources first so they keep their names, then attachments in the order given.
  const order = items.map((_item, index) => index).sort((a, b) => (items[a]!.kind === items[b]!.kind ? a - b : items[a]!.kind === 'source' ? -1 : 1));
  for (const index of order) {
    const item = items[index]!;
    const label = item.kind === 'attachment' ? `attachment '${item.name}'` : `source '${item.name}'`;
    if (item.byteSize > limits.maxItemBytes) {
      return fail('ITEM_TOO_LARGE', `${label} is ${item.byteSize} bytes; limit is ${limits.maxItemBytes}`);
    }
    let name = item.name.normalize('NFC');
    if (item.kind === 'attachment') {
      const problem = attachmentNameProblem(name);
      if (problem) return fail('INVALID_NAME', `${label} has an unsafe name: it ${problem}`);
      const clash = taken.get(clashKey(name));
      if (clash && clash.sha256 === item.sha256) {
        mapping.push({ index, given: item.name, used: clash.name, deduplicated: clash.name });
        continue;
      }
      if (clash) {
        const next = suffixed(name, new Set(taken.keys()));
        if (next === undefined) return fail('NAME_TOO_LONG', `${label} clashes with another item and its numbered name would be longer than ${limits.maxNameBytes} bytes`);
        name = next;
      }
    }
    if (kept.length + 1 > limits.maxItems) {
      return fail('TOO_MANY_ITEMS', `A launch can carry at most ${limits.maxItems} sources and attachments combined`);
    }
    total += item.byteSize;
    if (total > limits.maxTotalBytes) {
      return fail('TOTAL_TOO_LARGE', `Sources and attachments total ${total} bytes; limit is ${limits.maxTotalBytes}`);
    }
    // A source may share a name with an earlier source: the first one wins the reservation.
    if (!taken.has(clashKey(name))) taken.set(clashKey(name), { name, sha256: item.sha256 });
    kept.push({ index, name });
    if (item.kind === 'attachment') mapping.push({ index, given: item.name, used: name });
  }
  kept.sort((a, b) => a.index - b.index);
  mapping.sort((a, b) => a.index - b.index);
  return { ok: true, kept, mapping };
}
