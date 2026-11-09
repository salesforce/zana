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

it('signals done only for a live root completed turn, and waits for background work to settle', () => {
  const sounds = { observe: vi.fn(), remove: vi.fn(), resetThreads: vi.fn() };
  const stop = startAgentSoundEvents('http://localhost:1234', sounds), socket = h.sockets[0];
  const update = (value: any) => socket.emit('message', Buffer.from(JSON.stringify({ type: 'threads:updated', payload: value })));
  const event = (type: string, id = 'root', status = 'completed', parentToolCallId?: string) => socket.emit('message', Buffer.from(JSON.stringify({ type: 'threads:event', payload: { threadId: 'a', type, payload: { scope: { kind: 'turn', turnId: id }, status, parentToolCallId } } })));
  update({ ...thread, status: 'active' }); event('turn/started');
  event('turn/started', 'nested', 'completed', 'tool'); event('turn/completed', 'nested');
  expect(sounds.observe).not.toHaveBeenCalledWith('thread:a', 'done');
  event('turn/completed'); expect(sounds.observe).not.toHaveBeenCalledWith('thread:a', 'done');
  update({ ...thread, activity: { activeBackgroundCommandCount: 1 } });
  expect(sounds.observe).not.toHaveBeenCalledWith('thread:a', 'done');
  update(thread); expect(sounds.observe).toHaveBeenLastCalledWith('thread:a', 'done');
  const completed = sounds.observe.mock.calls.filter(([, state]) => state === 'done').length;
  update(thread); event('turn/completed');
  expect(sounds.observe.mock.calls.filter(([, state]) => state === 'done')).toHaveLength(completed);
  stop();
});
it('contains failed, interrupted, unmatched and disconnected completion events in either stream order', () => {
  const sounds = { observe: vi.fn(), remove: vi.fn(), resetThreads: vi.fn() };
  const stop = startAgentSoundEvents('http://localhost:1234', sounds), socket = h.sockets[0];
  const send = (payload: any) => socket.emit('message', Buffer.from(JSON.stringify(payload)));
  const update = (value: any) => send({ type: 'threads:updated', payload: value });
  const event = (type: string, status?: string) => send({ type: 'threads:event', payload: { threadId: 'a', type, payload: { scope: { kind: 'turn', turnId: 'root' }, status } } });
  for (const status of ['failed', 'interrupted', undefined]) {
    update({ ...thread, status: 'active' }); event('turn/started'); update(thread); event('turn/completed', status);
  }
  update({ ...thread, status: 'active' }); event('turn/completed', 'completed'); update(thread);
  event('turn/started'); update({ ...thread, status: 'stopping' }); event('turn/completed', 'completed'); update(thread);
  event('turn/started'); send({ type: 'product:reset' }); update(thread); event('turn/completed', 'completed');
  event('turn/started'); update({ ...thread, visibility: 'hidden' }); event('turn/completed', 'completed'); update(thread);
  for (const payload of [null, {}, { threadId: '' }, { threadId: 'x'.repeat(257) }, { threadId: 'a', payload: {} }, { threadId: 'a', payload: { scope: { kind: 'turn', turnId: '' } } }]) send({ type: 'threads:event', payload });
  expect(sounds.observe).not.toHaveBeenCalledWith('thread:a', 'done');
  event('turn/started'); update(thread); event('turn/completed', 'completed');
  expect(sounds.observe).toHaveBeenLastCalledWith('thread:a', 'done');
  stop();
});
it('bounds completion tracking without dropping live state into an unbounded history', () => {
  const sounds = { observe: vi.fn(), remove: vi.fn(), resetThreads: vi.fn() };
  const stop = startAgentSoundEvents('http://localhost:1234', sounds);
  for (let i = 0; i < 1002; i++) h.sockets[0].emit('message', Buffer.from(JSON.stringify({ type: 'threads:updated', payload: { ...thread, id: String(i) } })));
  expect(sounds.observe).toHaveBeenCalledTimes(1002); stop();
});

it('reads the canonical completion inside the host lifecycle transport envelope', () => {
  const sounds = { observe: vi.fn(), remove: vi.fn(), resetThreads: vi.fn() };
  const stop = startAgentSoundEvents('http://localhost:1234', sounds);
  const send = (type: string, payload: unknown) => h.sockets[0].emit('message', Buffer.from(JSON.stringify({ type, payload })));
  send('threads:updated', { ...thread, status: 'active' });
  send('threads:event', { threadId: 'a', kind: 'thread.event', type: 'turn/started',
    payload: { type: 'turn/started', scope: { kind: 'turn', turnId: 'root' } } });
  send('threads:event', { threadId: 'a', kind: 'turn.completed', type: 'turn.completed',
    payload: { type: 'turn/completed', scope: { kind: 'turn', turnId: 'root' }, status: 'completed' } });
  send('threads:updated', thread);
  expect(sounds.observe).toHaveBeenLastCalledWith('thread:a', 'done');
  stop();
});
