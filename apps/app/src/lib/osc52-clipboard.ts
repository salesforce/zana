/**
 * OSC 52 clipboard bridge.
 *
 * Terminal apps ask their emulator to put text on the SYSTEM clipboard by
 * emitting an OSC 52 sequence: `ESC ] 52 ; <Pc> ; <base64> BEL` (or ST). This is
 * the ONLY clipboard channel a REMOTE agent has — an `opencode`/`claude` process
 * running over ssh on a devbox cannot reach the operator's Mac clipboard by any
 * native API, so it copies by writing OSC 52 into its pty stream, which is
 * forwarded byte-for-byte to the local xterm. xterm.js recognises OSC 52 but
 * ships NO handler, so without the wiring below the "copied!" the agent reports
 * never reaches the local clipboard (the reported remote-copy dead-end).
 *
 * `parseOsc52` is the pure half: it takes the OSC payload xterm hands a
 * registered handler (everything after `ESC ] 52 ;`, i.e. `<Pc>;<Pd>`) and
 * returns the decoded text to copy, or a reason it declined. TerminalView
 * registers the handler and routes a successful decode to the main-process
 * clipboard via `copyText` (Rule 1 — main authorises the write; the renderer
 * clipboard is only the fallback).
 */

/**
 * Cap on the base64 payload we will decode. 140_000 base64 chars decode to
 * ~100 KiB — a generous copy while keeping an unbounded remote stream from
 * forcing a huge allocation on the main event loop (Rule 5). A larger payload
 * is dropped, not truncated (a truncated clipboard is worse than none).
 */
export const MAX_OSC52_BASE64_CHARS = 140_000;

export type Osc52Parse =
  | { ok: true; text: string }
  | { ok: false; reason: 'malformed' | 'read-request-ignored' | 'invalid-base64' | 'oversize' };

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function decodeBase64Utf8(b64: string): string {
  // atob yields a binary (latin1) string; re-interpret its bytes as UTF-8 so
  // multibyte copies (emoji, accented text) survive the round trip.
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Parse the payload of an OSC 52 sequence. `data` is what
 * `Terminal.parser.registerOscHandler(52, …)` passes: the bytes between
 * `ESC ] 52 ;` and the terminator, i.e. `<Pc>;<Pd>` where `Pc` is the clipboard
 * selection name(s) and `Pd` is base64 (or `?` for a READ/paste request).
 *
 * A read request (`?`) is deliberately DECLINED: honouring it would let a
 * remote agent exfiltrate whatever the operator has on their clipboard back
 * into the (possibly untrusted) remote session. We only ever accept WRITES.
 */
export function parseOsc52(data: string): Osc52Parse {
  const sep = data.indexOf(';');
  // No `;` → not a well-formed `Pc;Pd`; the empty-`Pc` form `;<b64>` is valid
  // (sep === 0) and handled below.
  if (sep < 0) return { ok: false, reason: 'malformed' };
  const payload = data.slice(sep + 1);
  if (payload === '?') return { ok: false, reason: 'read-request-ignored' };
  if (payload.length > MAX_OSC52_BASE64_CHARS) return { ok: false, reason: 'oversize' };
  if (!BASE64_RE.test(payload)) return { ok: false, reason: 'invalid-base64' };
  try {
    return { ok: true, text: decodeBase64Utf8(payload) };
  } catch {
    return { ok: false, reason: 'invalid-base64' };
  }
}

interface Disposable {
  dispose(): void;
}

/**
 * Minimal shape of the bits of `@xterm/xterm`'s `Terminal.parser` this bridge
 * needs — kept structural so this module stays free of an xterm import (and
 * trivially fakeable in tests). xterm invokes the handler with the OSC payload
 * once it has parsed a complete `ESC ] 52 ; … <terminator>` sequence, so the
 * base64 is guaranteed whole here even when it arrived split across pty chunks.
 */
export interface Osc52Registrar {
  registerOscHandler(ident: number, callback: (data: string) => boolean): Disposable;
}

/**
 * Register the OSC 52 clipboard handler on an xterm parser, routing a decoded
 * write to `copy` (the main-process clipboard path). The handler always returns
 * `true` so xterm treats the sequence as handled rather than falling back to
 * its no-op default or leaving bytes on screen — declined parses (read request,
 * oversize, malformed) are swallowed silently. Returns xterm's disposable.
 */
export function registerOsc52Clipboard(
  parser: Osc52Registrar,
  copy: (text: string) => void
): Disposable {
  return parser.registerOscHandler(52, (data) => {
    const parsed = parseOsc52(data);
    if (parsed.ok) copy(parsed.text);
    return true;
  });
}
