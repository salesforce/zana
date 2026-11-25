import { open } from 'node:fs/promises';
import { openConfined } from '../shared-io.js';

/** Bytes read from the end of a rollout. Bounded so a huge file never costs more than this. */
export const ROLLOUT_TAIL_BYTES = 256 * 1024;
/** The opening `session_meta` line embeds instructions and can be large; read at most this much to find it. */
const META_HEAD_BYTES = 512 * 1024;

export interface RolloutTail {
  /** Last bytes of the file (a leading partial line is possible). */
  readonly tail: Buffer;
  /** File offset of `tail[0]`. */
  readonly tailStartOffset: number;
  /** File size when read. */
  readonly size: number;
}

/** The rollout's size now, or null when it cannot be opened safely. Used as the turn-start marker. */
export async function rolloutSize(path: string, root: string): Promise<number | null> {
  const opened = await openConfined(path, root);
  if (!opened) return null;
  try { return opened.size; } finally { await opened.handle.close().catch(() => undefined); }
}

/** True when the rollout's first line is a `session_meta` whose id is `expectedId`. */
async function metaIdMatches(handle: Awaited<ReturnType<typeof open>>, size: number, expectedId: string): Promise<boolean> {
  const length = Math.min(size, META_HEAD_BYTES);
  const head = Buffer.alloc(length);
  const { bytesRead } = await handle.read(head, 0, length, 0);
  const nl = head.subarray(0, bytesRead).indexOf(0x0a);
  const line = head.subarray(0, nl === -1 ? bytesRead : nl).toString('utf8');
  try {
    const meta = JSON.parse(line) as { type?: unknown; payload?: { id?: unknown } };
    return meta.type === 'session_meta' && meta.payload?.id === expectedId;
  } catch {
    return false;
  }
}

/** Read the bounded tail of a confined rollout whose `session_meta.id` is `expectedId`; null otherwise. */
export async function readRolloutTail(path: string, root: string, expectedId: string): Promise<RolloutTail | null> {
  const opened = await openConfined(path, root);
  if (!opened) return null;
  const { handle, size } = opened;
  try {
    if (!(await metaIdMatches(handle, size, expectedId))) return null;
    const length = Math.min(size, ROLLOUT_TAIL_BYTES);
    const tailStartOffset = size - length;
    const tail = Buffer.alloc(length);
    const { bytesRead } = await handle.read(tail, 0, length, tailStartOffset);
    return { tail: tail.subarray(0, bytesRead), tailStartOffset, size };
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}
