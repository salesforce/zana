import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ sockets: [] as any[] }));
vi.mock('ws', () => ({ WebSocket: class extends EventEmitter {
  terminate = vi.fn(() => this.emit('close'));
  constructor(public url: URL, public options: unknown) { super(); h.sockets.push(this); }
} }));
import { startAgentSoundEvents, threadSoundState } from './agent-sound-events.js';
const thread = { id: 'a', visibility: 'visible', archivedAt: null, status: 'idle', activity: { activeBackgroundCommandCount: 0 } };
beforeEach(() => { vi.useFakeTimers(); h.sockets = []; });
afterEach(() => vi.useRealTimers());
it.each([
  [{}, null], [null, null], [{ id: '' }, null], [{ id: 'x'.repeat(257) }, null],
  [thread, { id: 'a', state: 'idle' }],
  [{ ...thread, status: 'active' }, { id: 'a', state: 'working' }],
  [{ ...thread, status: 'starting' }, { id: 'a', state: 'working' }],
  [{ ...thread, status: 'provisioning' }, { id: 'a', state: 'working' }],
  [{ ...thread, hasPendingInteraction: true }, { id: 'a', state: 'blocked' }],
  [{ ...thread, status: 'error', hasPendingInteraction: true }, { id: 'a', state: 'unknown' }],
  [{ ...thread, status: 'stopping' }, { id: 'a', state: 'unknown' }],
  [{ ...thread, status: 'host-reconnecting' }, { id: 'a', state: 'unknown' }],
  [{ ...thread, activity: { activeBackgroundCommandCount: 1 } }, { id: 'a', state: 'working' }],
  [{ ...thread, activity: undefined }, { id: 'a', state: 'idle' }],
  [{ ...thread, visibility: 'hidden' }, { id: 'a', state: null }],
  [{ ...thread, archivedAt: 1 }, { id: 'a', state: null }],
  [{ ...thread, status: 'closed' }, { id: 'a', state: null }],
])('projects %j', (input, expected) => expect(threadSoundState(input)).toEqual(expected));
it('subscribes once, ignores unrelated/malformed events, and forwards authoritative state', () => {
  const sounds = { observe: vi.fn(), remove: vi.fn(), resetThreads: vi.fn() };
  const stop = startAgentSoundEvents('http://127.0.0.1:1234/path', sounds);
  const socket = h.sockets[0];
  expect(socket.url.href).toBe('ws://127.0.0.1:1234/ws');
  for (const event of ['bad', '{"type":"threads:event"}', '{"type":"threads:updated","payload":null}']) socket.emit('message', Buffer.from(event));
  expect(sounds.observe).not.toHaveBeenCalled();
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'threads:updated', payload: thread })));
  expect(sounds.observe).toHaveBeenCalledWith('thread:a', 'idle');
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'threads:updated', payload: { ...thread, visibility: 'hidden' } })));
  expect(sounds.remove).toHaveBeenCalledWith('thread:a');
  socket.emit('message', Buffer.from('{"type":"product:reset"}'));
  expect(sounds.resetThreads).toHaveBeenCalledOnce();
  stop(); socket.emit('message', Buffer.from(JSON.stringify({ type: 'threads:updated', payload: thread })));
  vi.advanceTimersByTime(10_000); expect(h.sockets).toHaveLength(1); expect(sounds.observe).toHaveBeenCalledOnce();
});
it('reconnects after a disconnect, baselines threads, and cancels retry at shutdown', () => {
  const sounds = { observe: vi.fn(), remove: vi.fn(), resetThreads: vi.fn() };
  const stop = startAgentSoundEvents('https://localhost:1234', sounds);
  expect(h.sockets[0].url.protocol).toBe('wss:');
  h.sockets[0].emit('error', new Error('offline')); h.sockets[0].emit('close');
  vi.advanceTimersByTime(2_000); expect(h.sockets).toHaveLength(2);
  h.sockets[1].emit('close'); stop(); vi.advanceTimersByTime(5_000);
  expect(h.sockets).toHaveLength(2); expect(sounds.resetThreads).toHaveBeenCalled();
});
