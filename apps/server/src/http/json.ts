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
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
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

/** Peer pairing and link management are owner gestures on this machine; the phone proxy marks its requests. */
export function rejectMobilePeerManagement(request: IncomingMessage, response: ServerResponse): boolean {
  if (request.headers['x-zcc-app-surface'] !== 'mobile') return false;
  sendJson(response, 403, { error: 'peer links are managed from the desktop app' });
  return true;
}

/**
 * A 200 JSON response whose body may take minutes (a tool waiting on a person).
 * A fast answer goes out as plain `sendJson`. Once `heartbeatMs` passes, the
 * headers are flushed and a space is written every interval so client
 * header/body timeouts and relay idle limits never fire; JSON ignores the
 * leading whitespace. The status is fixed at 200 once streaming starts.
 */
export function beginSlowJson(
  response: ServerResponse,
  heartbeatMs = 20_000
): { send(body: unknown): void; stop(): void } {
  let streaming = false;
  const timer = setInterval(() => {
    if (response.writableEnded || response.destroyed) {
      stop();
      return;
    }
    if (!streaming) {
      streaming = true;
      response.writeHead(
        200,
        headersWithCors(response, {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8',
          'X-Content-Type-Options': 'nosniff'
        })
      );
      response.flushHeaders();
    }
    response.write(' ');
  }, heartbeatMs);
  const stop = () => {
    clearInterval(timer);
    response.removeListener('close', stop);
  };
  response.on('close', stop);
  return {
    send(body) {
      stop();
      if (streaming) response.end(JSON.stringify(body));
      else sendJson(response, 200, body);
    },
    stop
  };
}

export function sendNoContent(response: ServerResponse): void {
  response.writeHead(204, headersWithCors(response, { 'Cache-Control': 'no-store' })).end();
}

export function sendBytes(
  response: ServerResponse,
  status: number,
  body: Buffer,
  headers: Record<string, string>
): void {
  response.writeHead(status, headersWithCors(response, headers));
  response.end(body);
}

export function sendNdjson(response: ServerResponse, events: unknown[]): void {
  const stream = beginNdjson(response);
  for (const event of events) stream.write(event);
  stream.end();
}

export function beginNdjson(response: ServerResponse): {
  write(event: unknown): void;
  end(): void;
} {
  response.writeHead(
    200,
    headersWithCors(response, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    })
  );
  response.flushHeaders();
  return {
    write(event) {
      response.write(`${JSON.stringify(event)}\n`);
    },
    end() {
      response.end();
    }
  };
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
