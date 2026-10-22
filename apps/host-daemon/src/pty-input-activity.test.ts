import { describe, it, expect } from 'vitest';
import { classifyTerminalInput } from './pty-input-activity.js';

describe('classifyTerminalInput — terminal-generated reports are not key input', () => {
  it.each([
    ['X10/normal mouse', '\x1b[M #!'],
    ['X10 mouse with high bytes', '\x1b[M`\xff\xfe'],
    ['SGR mouse press', '\x1b[<0;12;34M'],
    ['SGR mouse release', '\x1b[<0;12;34m'],
    ['SGR any-motion', '\x1b[<35;100;7M'],
    ['urxvt mouse', '\x1b[32;12;34M'],
    ['focus in', '\x1b[I'],
    ['focus out', '\x1b[O'],
    ['cursor-position report', '\x1b[24;80R'],
    ['primary device attributes', '\x1b[?62;22c'],
    ['secondary device attributes', '\x1b[>0;276;0c'],
    ['OSC 10 reply, BEL', '\x1b]10;rgb:ffff/ffff/ffff\x07'],
    ['OSC 11 reply, ST', '\x1b]11;rgb:0000/0000/0000\x1b\\'],
    ['OSC 4 palette reply', '\x1b]4;1;rgb:cdcd/0000/0000\x07'],
    ['OSC 12 cursor-color reply', '\x1b]12;rgb:ffff/ffff/ffff\x1b\\'],
    ['DCS DECRQSS reply', '\x1bP1$r0;1m\x1b\\'],
    ['DCS XTVERSION reply', '\x1bP>|xterm.js(5.5)\x1b\\'],
    ['DECRPM private mode', '\x1b[?2004;1$y'],
    ['DECRPM ANSI mode', '\x1b[4;2$y'],
    ['empty write', '']
  ])('%s', (_name, data) => {
    expect(classifyTerminalInput(data, 0)).toEqual({ keyInput: false, draftChars: 0 });
    // A report never moves an existing count either.
    expect(classifyTerminalInput(data, 3)).toEqual({ keyInput: false, draftChars: 3 });
  });

  it('a burst of mixed reports is still not key input', () => {
    const burst =
      '\x1b[<35;1;1M\x1b[<35;2;1M\x1b[I\x1b[O\x1b[M #!\x1b[5;5R\x1b]11;rgb:0/0/0\x07\x1bP1$r0m\x1b\\\x1b[?1;2$y';
    expect(classifyTerminalInput(burst, 0)).toEqual({ keyInput: false, draftChars: 0 });
  });
});

describe('classifyTerminalInput — approximate draft length', () => {
  it('printable text adds one per character', () => {
    expect(classifyTerminalInput('h', 0)).toEqual({ keyInput: true, draftChars: 1 });
    expect(classifyTerminalInput('hello', 2)).toEqual({ keyInput: true, draftChars: 7 });
    expect(classifyTerminalInput('é', 0)).toEqual({ keyInput: true, draftChars: 1 });
  });

  it('LF (Shift+Enter / Ctrl-J) is a composer newline, not a submit', () => {
    expect(classifyTerminalInput('abc\n', 0)).toEqual({ keyInput: true, draftChars: 4 });
    expect(classifyTerminalInput('\n', 0)).toEqual({ keyInput: true, draftChars: 1 });
  });

  it.each([
    ['carriage return', '\r'],
    ['Ctrl-C', '\x03']
  ])('%s resets the count', (_name, data) => {
    expect(classifyTerminalInput(data, 5)).toEqual({ keyInput: true, draftChars: 0 });
  });

  it.each([
    ['DEL', '\x7f'],
    ['BS', '\b']
  ])('%s removes one character, floored at zero', (_name, data) => {
    expect(classifyTerminalInput(data, 2)).toEqual({ keyInput: true, draftChars: 1 });
    expect(classifyTerminalInput(data, 0)).toEqual({ keyInput: true, draftChars: 0 });
  });

  it('backspacing to empty reaches zero', () => {
    expect(classifyTerminalInput('ab\x7f\x7f', 0)).toEqual({ keyInput: true, draftChars: 0 });
    expect(classifyTerminalInput('a\x7f\x7f\x7f', 0)).toEqual({ keyInput: true, draftChars: 0 });
  });

  it.each([
    ['Ctrl-W', '\x17'],
    ['Ctrl-U', '\x15'],
    ['Alt-Backspace', '\x1b\x7f'],
    ['bare Esc', '\x1b'],
    ['double Esc', '\x1b\x1b'],
    ['tab', '\t'],
    ['Left arrow', '\x1b[D'],
    ['modified Right', '\x1b[1;5C'],
    ['Alt+b', '\x1bb'],
    ['Delete key', '\x1b[3~'],
    ['Up arrow with text', '\x1b[A'],
    ['Down arrow with text', '\x1b[B']
  ])('%s is key input but leaves a non-empty count unchanged', (_name, data) => {
    expect(classifyTerminalInput(data, 4)).toEqual({ keyInput: true, draftChars: 4 });
  });

  it.each([
    ['Up (CSI)', '\x1b[A'],
    ['Down (CSI)', '\x1b[B'],
    ['Up (SS3)', '\x1bOA'],
    ['Down (SS3)', '\x1bOB']
  ])('%s on an empty prompt holds the draft (recalled text is unknown)', (_name, data) => {
    expect(classifyTerminalInput(data, 0)).toEqual({ keyInput: true, draftChars: 1 });
  });

  it('bracketed-paste content adds its length, embedded newlines included', () => {
    expect(classifyTerminalInput('\x1b[200~ab\ncd\x1b[201~', 0)).toEqual({ keyInput: true, draftChars: 5 });
  });

  it('an empty bracketed paste is key input but adds nothing', () => {
    expect(classifyTerminalInput('\x1b[200~\x1b[201~', 0)).toEqual({ keyInput: true, draftChars: 0 });
  });

  it('a paste followed by Enter is a submit', () => {
    expect(classifyTerminalInput('\x1b[200~text\x1b[201~\r', 0)).toEqual({ keyInput: true, draftChars: 0 });
  });

  it('applies operations in stream order', () => {
    expect(classifyTerminalInput('abc\r', 0)).toEqual({ keyInput: true, draftChars: 0 });
    expect(classifyTerminalInput('\rabc', 2)).toEqual({ keyInput: true, draftChars: 3 });
    expect(classifyTerminalInput('abc\x03', 0)).toEqual({ keyInput: true, draftChars: 0 });
  });

  it('keys mixed with reports count only the keys', () => {
    expect(classifyTerminalInput('\x1b[<35;1;1Mx\x1b[I', 0)).toEqual({ keyInput: true, draftChars: 1 });
    expect(classifyTerminalInput('\x1b[<0;1;1M\r', 3)).toEqual({ keyInput: true, draftChars: 0 });
  });
});

describe('classifyTerminalInput — split chunks never throw', () => {
  it.each([
    ['SGR head', '\x1b[<35;1'],
    ['SGR tail', ';1M'],
    ['X10 head', '\x1b[M'],
    ['X10 partial', '\x1b[M '],
    ['CSI introducer only', '\x1b['],
    ['OSC unterminated', '\x1b]11;rgb:0000/00'],
    ['DCS unterminated', '\x1bP1$r0'],
    ['paste start, unterminated', '\x1b[200~partial paste'],
    ['paste end only', 'rest of paste\x1b[201~'],
    ['lone surrogate', '\ud800']
  ])('%s', (_name, data) => {
    expect(() => classifyTerminalInput(data, 0)).not.toThrow();
  });

  it('an unterminated paste start still counts its content', () => {
    expect(classifyTerminalInput('\x1b[200~partial', 0)).toEqual({ keyInput: true, draftChars: 7 });
  });
});
