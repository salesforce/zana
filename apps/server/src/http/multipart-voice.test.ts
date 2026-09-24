import { describe, expect, it } from 'vitest';
import { parseMultipartVoiceForm, readVoiceBody, VOICE_BODY_MAX_BYTES } from './multipart-voice.js';

function formBody(parts: string[], boundary = '----TestBoundary'): Buffer {
  return Buffer.from(parts.join(''), 'utf8');
}

describe('multipart voice form', () => {
  it('enforces the caller limit across chunks and retains the default voice limit', async () => {
    const request = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('abc');
        yield Buffer.from('def');
      }
    } as unknown as import('node:http').IncomingMessage;
    await expect(readVoiceBody(request, 6)).resolves.toEqual(Buffer.from('abcdef'));
    await expect(readVoiceBody(request, 5)).rejects.toMatchObject({ status: 413, code: 'too_large' });
    expect(VOICE_BODY_MAX_BYTES).toBe(25 * 1024 * 1024 + 64 * 1024);
    const oversized = {
      async *[Symbol.asyncIterator]() { yield Buffer.alloc(VOICE_BODY_MAX_BYTES + 1); }
    } as unknown as import('node:http').IncomingMessage;
    await expect(readVoiceBody(oversized)).rejects.toMatchObject({ status: 413 });
  });
  it('reads file bytes and an optional prompt', () => {
    const boundary = '----TestBoundary';
    const body = formBody([
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="file"; filename="recording.webm"\r\n',
      'Content-Type: audio/webm\r\n\r\n',
      'AUDIO\r\n',
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="prompt"\r\n\r\n',
      '  hello  \r\n',
      `--${boundary}--\r\n`
    ], boundary);
    const parsed = parseMultipartVoiceForm(body, `multipart/form-data; boundary=${boundary}`);
    expect(parsed.file).toEqual({
      filename: 'recording.webm',
      mimeType: 'audio/webm',
      bytes: Buffer.from('AUDIO')
    });
    expect(parsed.prompt).toBe('hello');
  });

  it('returns a null file when the audio part is absent', () => {
    const boundary = '----Empty';
    const body = formBody([
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="prompt"\r\n\r\n',
      '\r\n',
      `--${boundary}--\r\n`
    ], boundary);
    expect(parseMultipartVoiceForm(body, `multipart/form-data; boundary="${boundary}"`)).toEqual({
      file: null,
      prompt: undefined
    });
  });

  it('rejects a body without a multipart boundary', () => {
    expect(() => parseMultipartVoiceForm(Buffer.from('x'), 'multipart/form-data')).toThrow(/boundary/);
  });

  it('reads a bounded request body', async () => {
    const request = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('abc');
        yield 'def';
      }
    } as unknown as import('node:http').IncomingMessage;
    await expect(readVoiceBody(request)).resolves.toEqual(Buffer.from('abcdef'));
  });
});
