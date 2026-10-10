import { PRODUCT_EVENT_ARGS_MAX_CHARS, PRODUCT_EVENT_ARGS_MAX_COUNT, PRODUCT_EVENT_SNAPSHOT_CHANNELS } from '@zana-ai/zcc-contracts/runtime';

const isSnapshotChannel = (channel: string) => PRODUCT_EVENT_SNAPSHOT_CHANNELS.has(channel);
const TERMINAL_DATA = 'terminals:onData';

/** Split one oversized PTY chunk into ordered slices the utility schema accepts.
 * JSON escaping can grow control-heavy output up to 6x, so each slice is measured.
 * Returns null when not even one character fits beside the session id. */
export function splitTerminalData(sessionId: string, data: string, maxChars = PRODUCT_EVENT_ARGS_MAX_CHARS): string[] | null {
  const slices: string[] = [];
  const fits = (start: number, length: number) => JSON.stringify([sessionId, data.slice(start, start + length)]).length <= maxChars;
  for (let start = 0; start < data.length;) {
    // With a short id an eighth of the cap fits first time: escaping grows a character at most 6x.
    let length = Math.min(Math.max(1, Math.floor(maxChars / 8)), data.length - start);
    while (length > 1 && !fits(start, length)) length = Math.floor(length / 2);
    if (!fits(start, length)) return null;
    // Never split a surrogate pair across two slices.
    const last = data.charCodeAt(start + length - 1);
    if (start + length < data.length && length > 1 && last >= 0xd800 && last <= 0xdbff) length -= 1;
    slices.push(data.slice(start, start + length));
    start += length;
  }
  return slices;
}

/** Bound the main → product utility link before IPC serialization can accumulate.
 * A dropped notification is repaired by a snapshot read, never command replay. */
export function createProductEventForwarder(
  send: (channel: string, args: unknown[]) => Promise<unknown>,
  limits = { messages: 2048, bytes: 8 * 1024 * 1024 }
) {
  const queue: Array<{ channel: string; args: unknown[]; bytes: number; invalidation?: boolean }> = [];
  let bytes = 0, running = false, stopped = false, reset = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  async function drain() {
    if (running || stopped || retry) return;
    running = true;
    try {
      while (!stopped && (reset || queue.length)) {
        const entry = reset ? { channel: 'product:reset', args: [], bytes: 0 } : queue.shift()!;
        if (reset) reset = false;
        else bytes -= entry.bytes;
        try { await send(entry.channel, entry.args); }
        catch {
          queue.length = 0; bytes = 0; reset = true;
          if (!stopped) retry = setTimeout(() => { retry = undefined; void drain(); }, 1500);
          break;
        }
      }
    } finally { running = false; }
  }
  // Serialized once per event; the envelope adds the channel and fixed JSON keys.
  const envelopeBytes = (channel: string, json: string) => Buffer.byteLength(json) + Buffer.byteLength(channel) + 24;
  function publish(channel: string, args: unknown[], split = true): void {
    if (stopped) return;
    let size: number, argsLength: number;
    try { const json = JSON.stringify(args); argsLength = json.length; size = envelopeBytes(channel, json); }
    catch { argsLength = 0; size = limits.bytes + 1; }
    // An event the utility's schema would refuse must not stall the link: send a channel-scoped
    // invalidation so readers re-fetch the snapshot. A PTY chunk is split into ordered slices;
    // other streams cannot be re-read, so they still reset.
    const oversized = args.length > PRODUCT_EVENT_ARGS_MAX_COUNT || argsLength > PRODUCT_EVENT_ARGS_MAX_CHARS;
    if (split && oversized && channel === TERMINAL_DATA && args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
      const slices = splitTerminalData(args[0], args[1]);
      // Slices are enqueued without re-splitting; an unsplittable chunk falls through to reset.
      if (slices) { for (const slice of slices) publish(channel, [args[0], slice], false); return; }
    }
    const invalidation = oversized && isSnapshotChannel(channel);
    if (invalidation) { args = []; size = envelopeBytes(channel, '[]'); }
    const coalesce = isSnapshotChannel(channel) ? queue.findIndex(entry => entry.channel === channel) : -1;
    const pending = queue.findIndex(entry => entry.channel === channel && entry.invalidation);
    if (reset) { /* a pending global reset supersedes everything */ }
    else if (invalidation && pending >= 0) { /* one invalidation per channel */ }
    else if (coalesce >= 0 && bytes - queue[coalesce]!.bytes + size <= limits.bytes) {
      bytes += size - queue[coalesce]!.bytes; queue[coalesce] = { channel, args, bytes: size, invalidation };
    } else if ((oversized && !invalidation) || size > limits.bytes || bytes + size > limits.bytes || queue.length >= limits.messages) {
      queue.length = 0; bytes = 0; reset = true;
    } else { queue.push({ channel, args, bytes: size, invalidation }); bytes += size; }
    void drain();
  }
  return {
    publish: (channel: string, args: unknown[]) => publish(channel, args),
    dispose() {
      stopped = true; queue.length = 0; bytes = 0; reset = false;
      if (retry) clearTimeout(retry);
      retry = undefined;
    }
  };
}
