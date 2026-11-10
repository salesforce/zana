import { describe, expect, it } from 'vitest';
import {
  DISPATCH_ADMISSION_PROMPT_MAX_BYTES,
  admissionPromptFromInput,
  buildAdmissionPrompt,
  capUtf8,
  redactPromptText
} from './admission-prompt.js';

describe('redactPromptText', () => {
  it.each([
    ['password=hunter2 then more', 'password=[REDACTED] then more'],
    ['API_KEY: abcdef123456', 'API_KEY: [REDACTED]'],
    ['{"client_secret": "s3cr3t value"}', '{"client_secret": [REDACTED]}'],
    ['Authorization: Bearer abcdefghijklmnop', 'Authorization: Bearer [REDACTED]'],
    ['use sk-abcdefghijklmnopqrstuv now', 'use [REDACTED] now'],
    ['token ghp_abcdefghijklmnopqrstuvwx', 'token [REDACTED]'],
    ['id AKIAABCDEFGHIJKLMNOP', 'id [REDACTED]']
  ])('redacts %s', (input, expected) => {
    expect(redactPromptText(input)).toBe(expected);
  });

  it('redacts values longer than the old 2048-char bound, quoted, unquoted or unterminated', () => {
    const long = 'a'.repeat(3_000);
    expect(redactPromptText(`password="${long}"`)).toBe('password=[REDACTED]');
    expect(redactPromptText(`password="${long}`)).toBe('password=[REDACTED]');
    expect(redactPromptText(`token=${long} end`)).toBe('token=[REDACTED] end');
  });

  it('redacts a private key block, including an unterminated one', () => {
    expect(redactPromptText('a -----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY----- b')).toBe('a [REDACTED] b');
    expect(redactPromptText('a -----BEGIN PRIVATE KEY-----\nabc')).toBe('a [REDACTED]');
  });

  it('leaves ordinary prose alone', () => {
    expect(redactPromptText('please fix the login flow')).toBe('please fix the login flow');
  });
});

describe('capUtf8', () => {
  it('keeps text within the cap', () => {
    expect(capUtf8('abc', 3)).toEqual({ text: 'abc', truncated: false });
  });

  it('cuts at the byte cap and flags it', () => {
    expect(capUtf8('abcdef', 4)).toEqual({ text: 'abcd', truncated: true });
  });

  it('never splits a multibyte character or a surrogate pair', () => {
    const cut = capUtf8('aé€😀', 5);
    expect(cut.truncated).toBe(true);
    expect(Buffer.byteLength(cut.text, 'utf8')).toBeLessThanOrEqual(5);
    expect(cut.text).toBe('aé');
    expect(capUtf8('😀😀', 6).text).toBe('😀');
  });

  it('caps large multibyte text quickly and on a code-point boundary', () => {
    const started = Date.now();
    const cut = capUtf8('€'.repeat(40_000), 32_768);
    expect(Date.now() - started).toBeLessThan(500);
    expect(cut.truncated).toBe(true);
    expect(Buffer.byteLength(cut.text, 'utf8')).toBe(32_766);
    expect(cut.text).not.toContain('\ufffd');
  });
});

describe('buildAdmissionPrompt', () => {
  it('redacts before capping and reports attachments', () => {
    expect(buildAdmissionPrompt({ text: 'token=abc', attachmentCount: 2.9 })).toEqual({
      text: 'token=[REDACTED]',
      truncated: false,
      attachmentCount: 2
    });
  });

  it('caps at 32 KiB and flags truncation', () => {
    const built = buildAdmissionPrompt({ text: 'a'.repeat(DISPATCH_ADMISSION_PROMPT_MAX_BYTES + 10) });
    expect(Buffer.byteLength(built.text, 'utf8')).toBe(DISPATCH_ADMISSION_PROMPT_MAX_BYTES);
    expect(built.truncated).toBe(true);
    expect(built.attachmentCount).toBe(0);
  });

  it('flags text the caller already cut and clamps a negative count', () => {
    expect(buildAdmissionPrompt({ text: 'x', truncated: true, attachmentCount: -3 })).toEqual({
      text: 'x',
      truncated: true,
      attachmentCount: 0
    });
  });

  it('bounds the redaction scan for a huge prompt', () => {
    const built = buildAdmissionPrompt({ text: 'a'.repeat(DISPATCH_ADMISSION_PROMPT_MAX_BYTES * 8) });
    expect(built.truncated).toBe(true);
    expect(Buffer.byteLength(built.text, 'utf8')).toBe(DISPATCH_ADMISSION_PROMPT_MAX_BYTES);
  });
});

describe('admissionPromptFromInput', () => {
  it('joins strings and text parts and counts attachments', () => {
    expect(
      admissionPromptFromInput([
        'one',
        { type: 'text', text: 'two' },
        { type: 'localImage', path: '/x.png' },
        { type: 'localFile', path: '/y.txt' },
        { type: 'mention', name: 'm' },
        { type: 'text', text: 5 },
        null,
        ''
      ])
    ).toEqual({ text: 'one\ntwo', attachmentCount: 2 });
  });

  it('accepts a bare string and ignores other shapes', () => {
    expect(admissionPromptFromInput('hi')).toEqual({ text: 'hi', attachmentCount: 0 });
    expect(admissionPromptFromInput(42)).toEqual({ text: '', attachmentCount: 0 });
    expect(admissionPromptFromInput(undefined)).toEqual({ text: '', attachmentCount: 0 });
  });
});
