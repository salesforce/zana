import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { LIMITS, headers, validPath, parseFrame, send, dataFrames, dataFramesFlushed, bytes, heartbeat, remoteOrigin, validToken } from './protocol.mjs';

afterEach(() => vi.useRealTimers());
function socket() { return Object.assign(new EventEmitter(), { readyState: WebSocket.OPEN, bufferedAmount: 0, send: vi.fn(), terminate: vi.fn(), ping: vi.fn() }); }
describe('bounded relay protocol', () => {
  it('allows only necessary HTTP headers, preserving secure session cookies', () => {
    expect(headers({ cookie: 'session', authorization: 'Bearer test', 'x-forwarded-host': 'evil', host: 'evil', connection: 'upgrade' })).toEqual({ cookie: 'session', authorization: 'Bearer test' });
    expect(headers({ 'set-cookie': ['a=1; Secure', 'b=2; HttpOnly'], location: '/agents' }, true)).toEqual({ 'set-cookie': ['a=1; Secure', 'b=2; HttpOnly'], location: '/agents' });
    expect(headers({ 'content-security-policy': "default-src 'self'", 'x-frame-options': 'DENY' }, true)).toEqual({ 'content-security-policy': "default-src 'self'", 'x-frame-options': 'DENY' });
    for (const input of [null, [], { cookie: ['bad'] }, { cookie: 'a\r\nb' }, { cookie: 42 }, { cookie: 'x'.repeat(33 * 1024) }]) expect(() => headers(input)).toThrow();
  });
  it('rejects absolute targets and ambiguous request paths', () => {
    expect(validPath('/api/v1/projects?q=a%2Fb')).toBe(true);
    for (const path of ['https://evil.test', '//evil.test', '/\\evil', '/\r\n', '/_relay/connect', '/'+ 'a'.repeat(17 * 1024), null]) expect(validPath(path)).toBe(false);
  });
  it('validates frame IDs, JSON and binary limits', () => {
    expect(parseFrame(Buffer.from('{"type":"cancel","id":1}'))).toEqual({ type: 'cancel', id: 1 });
    for (const value of [null, {}, { id: -1, type: 'request' }, { id: 1.5, type: 'request' }, { id: 2 ** 32, type: 'request' }, { id: 1, type: 1 }]) expect(() => parseFrame(Buffer.from(JSON.stringify(value)))).toThrow();
    expect(() => parseFrame(Buffer.from('bad'))).toThrow();
    expect(bytes({ data: 'aGk=' }).toString()).toBe('hi');
    const large = Buffer.alloc(1024 * 1024, 123);
    expect(bytes({ data: large.toString('base64') }, large.length)).toEqual(large);
    for (const value of [null, '!', 'abc', 'x'.repeat(100)]) expect(() => bytes({ data: value }, 10)).toThrow();
    expect(() => bytes({ data: Buffer.alloc(11).toString('base64') }, 10)).toThrow();
  });
  it('splits HTTP bodies into bounded frames and closes overloaded peers', () => {
    const ws = socket();
    expect(dataFrames(ws, 'response-data', 1, Buffer.alloc(LIMITS.chunk + 5))).toBe(true);
    expect(ws.send).toHaveBeenCalledTimes(2);
    expect(bytes(JSON.parse(ws.send.mock.calls[1][0]))).toHaveLength(5);
    ws.readyState = WebSocket.CLOSED; expect(send(ws, {})).toBe(false);
    expect(dataFrames(ws, 'response-data', 1, Buffer.from('x'))).toBe(false);
    ws.readyState = WebSocket.OPEN; ws.bufferedAmount = LIMITS.buffer;
    expect(send(ws, { type: 'hello', id: 0 })).toBe(false); expect(ws.terminate).toHaveBeenCalled();
    ws.bufferedAmount = 0; expect(send(ws, { data: 'x'.repeat(LIMITS.frame) })).toBe(false);
  });
  it('sends heartbeat traffic, detects missing pongs and releases the timer', () => {
    vi.useFakeTimers(); const ws = socket(); heartbeat(ws, 100);
    vi.advanceTimersByTime(100); expect(ws.ping).toHaveBeenCalledOnce();
    ws.emit('pong'); vi.advanceTimersByTime(100); expect(ws.ping).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(100); expect(ws.terminate).toHaveBeenCalledOnce();
    ws.emit('close'); expect(vi.getTimerCount()).toBe(0); expect(ws.listenerCount('pong')).toBe(0);
  });
  it('pings again instead of terminating after its own event loop stalled', () => {
    vi.useFakeTimers(); const ws = socket(); heartbeat(ws, 100, 50);
    vi.advanceTimersByTime(100); expect(ws.ping).toHaveBeenCalledOnce();
    vi.setSystemTime(Date.now() + 1_000); vi.advanceTimersByTime(100);
    expect(ws.terminate).not.toHaveBeenCalled(); expect(ws.ping).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(100); expect(ws.terminate).toHaveBeenCalledOnce();
  });
  it('waits for each response frame to flush and stops on cancellation or send failure', async () => {
    const ws = socket(); const active = vi.fn(() => true);
    const pending = dataFramesFlushed(ws, 'response-data', 1, Buffer.alloc(LIMITS.chunk + 5), active);
    expect(ws.send).toHaveBeenCalledTimes(1);
    ws.send.mock.calls[0][1](); await Promise.resolve();
    expect(ws.send).toHaveBeenCalledTimes(2);
    expect(bytes(JSON.parse(ws.send.mock.calls[1][0]))).toHaveLength(5);
    ws.send.mock.calls[1][1](); expect(await pending).toBe(true);
    const cancelled = dataFramesFlushed(ws, 'response-data', 2, Buffer.alloc(LIMITS.chunk + 1), active);
    active.mockReturnValue(false); ws.send.mock.calls[2][1]();
    expect(await cancelled).toBe(false); expect(ws.send).toHaveBeenCalledTimes(3);
    active.mockReturnValue(true);
    const failed = dataFramesFlushed(ws, 'response-data', 3, Buffer.from('x'), active);
    ws.send.mock.calls[3][1](new Error('closed')); expect(await failed).toBe(false);
    ws.readyState = WebSocket.CLOSED;
    expect(await dataFramesFlushed(ws, 'response-data', 4, Buffer.from('x'), active)).toBe(false);
  });
  it('requires HTTPS and a strong token outside explicit local tests', () => {
    expect(remoteOrigin('https://relay.example').origin).toBe('https://relay.example');
    expect(remoteOrigin('http://127.0.0.1:1234', true).port).toBe('1234');
    for (const url of ['http://public.example', 'http://127.0.0.1', 'https://a:b@relay.example', 'https://relay.example/path', 'https://relay.example?q=x', 'https://relay.example#x', `https://${'a'.repeat(2048)}`, null]) expect(() => remoteOrigin(url)).toThrow();
    expect(validToken('a'.repeat(43))).toBe(true); expect(validToken('short')).toBe(false); expect(validToken('é'.repeat(43))).toBe(false);
  });
});
