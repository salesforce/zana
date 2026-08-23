import type { IncomingMessage } from 'node:http';

export const VOICE_TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;
const VOICE_BODY_MAX_BYTES = VOICE_TRANSCRIPTION_MAX_BYTES + 64 * 1024;

export interface VoiceFormFile {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

export interface VoiceTranscriptionForm {
  file: VoiceFormFile | null;
  prompt: string | undefined;
}

function headerValue(headers: IncomingMessage['headers'], name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function boundaryFromContentType(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/iu.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  return boundary && boundary.length > 0 ? boundary.trim() : null;
}

function headerBlock(part: Buffer): { headers: string; body: Buffer } | null {
  const split = part.indexOf('\r\n\r\n');
  if (split < 0) return null;
  return {
    headers: part.subarray(0, split).toString('utf8'),
    body: part.subarray(split + 4)
  };
}

function stripTrailingCrlf(body: Buffer): Buffer {
  if (body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10) {
    return body.subarray(0, body.length - 2);
  }
  return body;
}

function parseDisposition(headers: string): { name: string | null; filename: string | null } {
  const line = headers.split('\r\n').find((row) => row.toLowerCase().startsWith('content-disposition:'));
  if (!line) return { name: null, filename: null };
  const name = /name="([^"]*)"/u.exec(line)?.[1] ?? null;
  const filename = /filename="([^"]*)"/u.exec(line)?.[1] ?? null;
  return { name, filename };
}

function parsePartContentType(headers: string): string {
  const line = headers.split('\r\n').find((row) => row.toLowerCase().startsWith('content-type:'));
  return line ? line.slice('content-type:'.length).trim() : 'application/octet-stream';
}

export function parseMultipartVoiceForm(body: Buffer, contentType: string): VoiceTranscriptionForm {
  const boundary = boundaryFromContentType(contentType);
  if (!boundary) {
    throw Object.assign(new Error('multipart boundary is required'), { status: 400, code: 'invalid_request' });
  }
  const token = Buffer.from(`--${boundary}`);
  const endToken = Buffer.from(`--${boundary}--`);
  const form: VoiceTranscriptionForm = { file: null, prompt: undefined };
  let offset = body.indexOf(token);
  if (offset < 0) return form;
  offset += token.length;
  if (body[offset] === 13 && body[offset + 1] === 10) offset += 2;

  while (offset < body.length) {
    const next = body.indexOf(token, offset);
    const end = body.indexOf(endToken, offset);
    const close = next >= 0 && (end < 0 || next <= end) ? next : end;
    if (close < 0) break;
    const rawPart = body.subarray(offset, close);
    const parsed = headerBlock(stripLeadingCrlf(rawPart));
    if (parsed) {
      const disposition = parseDisposition(parsed.headers);
      const partBody = stripTrailingCrlf(parsed.body);
      if (disposition.name === 'file') {
        form.file = {
          filename: disposition.filename || 'recording.webm',
          mimeType: parsePartContentType(parsed.headers),
          bytes: partBody
        };
      } else if (disposition.name === 'prompt') {
        const prompt = partBody.toString('utf8').trim();
        form.prompt = prompt.length > 0 ? prompt : undefined;
      }
    }
    if (end >= 0 && close === end) break;
    offset = close + token.length;
    if (body[offset] === 13 && body[offset + 1] === 10) offset += 2;
  }
  return form;
}

function stripLeadingCrlf(part: Buffer): Buffer {
  if (part.length >= 2 && part[0] === 13 && part[1] === 10) return part.subarray(2);
  return part;
}

export async function readVoiceBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > VOICE_BODY_MAX_BYTES) {
      throw Object.assign(new Error('request body too large'), { status: 413, code: 'too_large' });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export { VOICE_BODY_MAX_BYTES };
