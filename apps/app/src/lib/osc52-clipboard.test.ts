import { describe, expect, it, vi } from 'vitest';
import {
  MAX_OSC52_BASE64_CHARS,
  parseOsc52,
  registerOsc52Clipboard,
  type Osc52Registrar
} from './osc52-clipboard.js';

/** Encode UTF-8 text to base64 the way an emitting terminal app would. */
function b64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

describe('parseOsc52', () => {
  it('decodes a well-formed `c;<base64>` write to the original text', () => {
    const res = parseOsc52(`c;${b64('hello clipboard')}`);
    expect(res).toEqual({ ok: true, text: 'hello clipboard' });
  });

  it('accepts the empty-selection form `;<base64>`', () => {
    const res = parseOsc52(`;${b64('no selection name')}`);
    expect(res).toEqual({ ok: true, text: 'no selection name' });
  });

  it('accepts multi-char / other selection names (p, s0, q)', () => {
    expect(parseOsc52(`p;${b64('primary')}`)).toEqual({ ok: true, text: 'primary' });
    expect(parseOsc52(`s0;${b64('select0')}`)).toEqual({ ok: true, text: 'select0' });
  });

  it('round-trips multibyte UTF-8 (emoji + accents), not latin1 garble', () => {
    const text = 'café ☕ → 完了 ✅';
    const res = parseOsc52(`c;${b64(text)}`);
    expect(res).toEqual({ ok: true, text });
  });

  it('REFUSES a read request `c;?` so a remote session cannot exfiltrate the local clipboard', () => {
    expect(parseOsc52('c;?')).toEqual({ ok: false, reason: 'read-request-ignored' });
  });

  it('rejects a payload with no `;` separator as malformed', () => {
    expect(parseOsc52('garbagewithoutsemicolon')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects non-base64 payload characters (defends the decoder)', () => {
    expect(parseOsc52('c;not valid base64!!')).toEqual({ ok: false, reason: 'invalid-base64' });
  });

  it('rejects an oversize payload instead of decoding it (bounded — Rule 5)', () => {
    const huge = 'A'.repeat(MAX_OSC52_BASE64_CHARS + 1);
    expect(parseOsc52(`c;${huge}`)).toEqual({ ok: false, reason: 'oversize' });
  });

  it('accepts a payload exactly at the cap', () => {
    // Build a valid base64 string of exactly MAX chars (multiple of 4, no padding).
    const atCap = 'A'.repeat(MAX_OSC52_BASE64_CHARS);
    const res = parseOsc52(`c;${atCap}`);
    expect(res.ok).toBe(true);
  });

  it('treats an empty base64 payload as an empty (clear) copy, not an error', () => {
    expect(parseOsc52('c;')).toEqual({ ok: true, text: '' });
  });
});

describe('registerOsc52Clipboard', () => {
  function fakeParser(): { parser: Osc52Registrar; fire: (data: string) => boolean } {
    let handler: ((data: string) => boolean) | null = null;
    return {
      parser: {
        registerOscHandler: (ident, cb) => {
          expect(ident).toBe(52);
          handler = cb;
          return { dispose: () => {} };
        }
      },
      fire: (data) => {
        if (!handler) throw new Error('no handler registered');
        return handler(data);
      }
    };
  }

  it('routes a decoded write to the copy sink and claims the sequence', () => {
    const copy = vi.fn();
    const { parser, fire } = fakeParser();
    registerOsc52Clipboard(parser, copy);
    const handled = fire(`c;${b64('remote agent output')}`);
    expect(handled).toBe(true);
    expect(copy).toHaveBeenCalledWith('remote agent output');
  });

  it('swallows a read request WITHOUT copying (no clipboard exfil path)', () => {
    const copy = vi.fn();
    const { parser, fire } = fakeParser();
    registerOsc52Clipboard(parser, copy);
    const handled = fire('c;?');
    expect(handled).toBe(true);
    expect(copy).not.toHaveBeenCalled();
  });

  it('swallows a malformed/oversize sequence without copying', () => {
    const copy = vi.fn();
    const { parser, fire } = fakeParser();
    registerOsc52Clipboard(parser, copy);
    expect(fire('junk-no-semicolon')).toBe(true);
    expect(fire(`c;${'A'.repeat(MAX_OSC52_BASE64_CHARS + 4)}`)).toBe(true);
    expect(copy).not.toHaveBeenCalled();
  });
});
