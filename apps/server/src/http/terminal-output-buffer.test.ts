import { describe, expect, it } from 'vitest';
import {
  appendBoundedTerminalOutput,
  PRODUCT_TERMINAL_OUTPUT_MAX_BYTES,
  terminalOutputSlice
} from './terminal-output-buffer.js';

describe('bounded terminal output', () => {
  it('appends until the cap then drops from the front', () => {
    const first = appendBoundedTerminalOutput(undefined, 'hello ', 10);
    expect(first).toEqual({ text: 'hello ', truncated: false });
    const second = appendBoundedTerminalOutput(first, 'world!!', 10);
    expect(second.truncated).toBe(true);
    expect(Buffer.byteLength(second.text, 'utf8')).toBeLessThanOrEqual(10);
    expect(second.text.endsWith('world!!')).toBe(true);
  });

  it('tails a prefix of the buffer', () => {
    const buffer = { text: 'abcdef', truncated: false };
    expect(terminalOutputSlice(buffer, 3)).toEqual({ text: 'def', truncated: true });
    expect(terminalOutputSlice(undefined)).toEqual({ text: '', truncated: false });
  });

  it('uses the product cap by default', () => {
    expect(PRODUCT_TERMINAL_OUTPUT_MAX_BYTES).toBe(256 * 1024);
  });
});
