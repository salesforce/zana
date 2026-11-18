import { describe, expect, it } from 'vitest';
import { hasLine, plainLines } from '../../../../e2e/fixtures/terminal-lines.js';

const ESC = '\x1b';
const BEL = '\x07';

describe('e2e terminal-lines plainLines', () => {
  it('returns one empty line for empty input', () => {
    expect(plainLines('')).toEqual(['']);
  });

  it('splits CRLF and bare LF output into lines', () => {
    expect(plainLines('one\r\ntwo\nthree')).toEqual(['one', 'two', 'three']);
  });

  it('drops a carriage return used to repaint a line', () => {
    expect(plainLines('partial\rMARKER\r\n')).toEqual(['partialMARKER', '']);
  });

  it('strips CSI cursor, erase, colour and private-mode sequences', () => {
    const raw = `${ESC}[?25l${ESC}[2J${ESC}[H${ESC}[1;32mMARKER${ESC}[0m${ESC}[K${ESC}[?2004h\r\n`;
    expect(plainLines(raw)).toEqual(['MARKER', '']);
  });

  it('strips OSC sequences ended by BEL and by ST', () => {
    const raw = `${ESC}]0;title${BEL}A\n${ESC}]52;c;UEFTVEU=${ESC}\\B\n`;
    expect(plainLines(raw)).toEqual(['A', 'B', '']);
  });

  it('trims trailing padding but keeps leading spaces', () => {
    expect(plainLines('  MARKER      \r\n')).toEqual(['  MARKER', '']);
  });
});

describe('e2e terminal-lines hasLine', () => {
  it('matches a marker that is a whole line after cleanup', () => {
    expect(hasLine(`$ echo M_$((40+2))\r\n${ESC}[KM_42   \r\n$ `, 'M_42')).toBe(true);
  });

  it('rejects a marker that only appears inside a longer line', () => {
    expect(hasLine('M_42echo\r\nprefix M_42\r\n', 'M_42')).toBe(false);
  });

  it('rejects a marker when the backlog is empty', () => {
    expect(hasLine('', 'M_42')).toBe(false);
  });
});
