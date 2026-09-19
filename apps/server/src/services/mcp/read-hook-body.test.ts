import type { IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOOK_BODY_CAP, readHookBody } from './read-hook-body.js';

describe('bounded hook body reader', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.runAllTimers(); vi.useRealTimers(); });
  const stream = () => new PassThrough() as unknown as IncomingMessage & PassThrough;

  it('reads split UTF-8 and empty legacy notifications', async () => {
    const req = stream();
    const body = readHookBody(req);
    const text = Buffer.from('☃');
    req.write(text.subarray(0, 1));
    req.end(text.subarray(1));
    await expect(body).resolves.toBe('☃');
    const empty = stream();
    const result = readHookBody(empty);
    empty.end();
    await expect(result).resolves.toBe('');
    expect(req.listenerCount('data')).toBe(0);
  });

  it('discards oversized payloads and releases the buffer', async () => {
    const req = stream();
    const body = readHookBody(req);
    req.end(Buffer.alloc(HOOK_BODY_CAP + 1));
    await expect(body).resolves.toBeNull();
    expect(req.listenerCount('data')).toBe(0);
  });

  it.each(['aborted', 'error'])('discards %s requests', async (event) => {
    const req = stream();
    const body = readHookBody(req);
    req.emit(event, new Error('closed'));
    await expect(body).resolves.toBeNull();
  });

  it('times out slow senders', async () => {
    const req = stream();
    const body = readHookBody(req);
    req.write('partial');
    vi.advanceTimersByTime(5000);
    await expect(body).resolves.toBeNull();
    req.end('too late');
  });

  it('caps simultaneous readers and releases their slots', async () => {
    const requests = Array.from({ length: 32 }, stream);
    const reads = requests.map(readHookBody);
    await expect(readHookBody(stream())).resolves.toBeNull();
    requests.forEach((req) => req.end());
    await expect(Promise.all(reads)).resolves.toEqual(Array(32).fill(''));
    const next = stream();
    const body = readHookBody(next);
    next.end('ok');
    await expect(body).resolves.toBe('ok');
  });
});
