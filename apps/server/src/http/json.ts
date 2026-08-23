import type { IncomingMessage, ServerResponse } from 'node:http';

const CORS_HEADER_NAMES = [
  'Access-Control-Allow-Origin',
  'Access-Control-Allow-Headers',
  'Access-Control-Allow-Methods',
  'Vary'
] as const;

export function applyTrustedOriginCors(response: ServerResponse, origin: string): void {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Headers', 'content-type, x-zcc-app-surface');
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
  response.setHeader('Vary', 'Origin');
}

function headersWithCors(response: ServerResponse, base: Record<string, string>): Record<string, string> {
  const headers = { ...base };
  for (const name of CORS_HEADER_NAMES) {
    const value = response.getHeader(name);
    if (typeof value === 'string') headers[name] = value;
  }
  return headers;
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(
    status,
    headersWithCors(response, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    })
  );
  response.end(JSON.stringify(body));
}

export function sendNoContent(response: ServerResponse): void {
  response.writeHead(204, headersWithCors(response, { 'Cache-Control': 'no-store' })).end();
}

export async function readJsonBody(request: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim().length === 0) return {};
  return JSON.parse(raw) as unknown;
}
