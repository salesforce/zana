/**
 * @vitest-environment happy-dom
 *
 * Integration check against a REAL `@xterm/xterm` parser: proves that a
 * complete `ESC ] 52 ; c ; <base64> BEL` written through `term.write()` is
 * dispatched to the handler `registerOsc52Clipboard` installs, and that the
 * base64 survives xterm's own OSC parsing — including when the sequence is
 * split across two `write()` chunks (the pty-chunk-boundary case a pure
 * `parseOsc52` unit test can't cover). This is the closest deterministic proxy
 * for the production boundary without a real remote host; the true remote path
 * still needs a live check (see report).
 */
import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { registerOsc52Clipboard } from './osc52-clipboard.js';

function b64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

/** Resolve after xterm has drained its write buffer (write is async). */
function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

describe('OSC 52 through a real xterm parser', () => {
  it('dispatches a whole ESC]52 write to the clipboard sink', async () => {
    const term = new Terminal({ allowProposedApi: true });
    const copied: string[] = [];
    registerOsc52Clipboard(term.parser, (t) => copied.push(t));

    await write(term, `\x1b]52;c;${b64('copied from agent')}\x07`);

    expect(copied).toEqual(['copied from agent']);
    term.dispose();
  });

  it('reassembles a sequence split across two pty chunks', async () => {
    const term = new Terminal({ allowProposedApi: true });
    const copied: string[] = [];
    registerOsc52Clipboard(term.parser, (t) => copied.push(t));

    const seq = `\x1b]52;c;${b64('split across chunks')}\x07`;
    const mid = Math.floor(seq.length / 2);
    await write(term, seq.slice(0, mid));
    await write(term, seq.slice(mid));

    expect(copied).toEqual(['split across chunks']);
    term.dispose();
  });

  it('does not copy on a plain-text write with no OSC 52', async () => {
    const term = new Terminal({ allowProposedApi: true });
    const copied: string[] = [];
    registerOsc52Clipboard(term.parser, (t) => copied.push(t));

    await write(term, 'just some normal terminal output\r\n');

    expect(copied).toEqual([]);
    term.dispose();
  });
});
