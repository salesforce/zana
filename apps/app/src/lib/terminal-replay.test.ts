import { afterEach, expect, it, vi } from 'vitest';
import { createTerminalReplay } from './terminal-replay.js';
afterEach(() => vi.useRealTimers());
const display = () => ({ reset: vi.fn(), write: vi.fn(), follow: vi.fn() });
it('orders retained and live output and resets only on reconnection', async () => {
  let resolve!: (text: string) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<string>(r => { resolve = r; })).mockResolvedValue('new tail');
  const view = display(), replay = createTerminalReplay(read, view);
  const initial = replay.replay(); replay.receive('live'); resolve('old'); await initial;
  expect(view.write.mock.calls).toEqual([['old'], ['live']]); expect(view.reset).not.toHaveBeenCalled();
  replay.receive('next'); expect(view.write).toHaveBeenLastCalledWith('next');
  await replay.replay(true); expect(view.reset).toHaveBeenCalledOnce(); expect(view.write).toHaveBeenLastCalledWith('new tail'); replay.dispose();
});
it('bounds buffered live output during a stalled read and marks a gap', async () => {
  vi.useFakeTimers(); const view = display(), replay = createTerminalReplay(() => new Promise(() => {}), view, 4);
  const pending = replay.replay(); replay.receive('1234'); replay.receive('5678');
  await vi.advanceTimersByTimeAsync(10_000); await pending;
  expect(view.write.mock.calls).toEqual([['\r\n[Some output was missed while reconnecting.]\r\n'], ['5678']]); replay.dispose();
});
it('coalesces reconnect bursts and cancels a pending read on disposal', async () => {
  let resolve!: (text: string) => void;
  const view = display(), read = vi.fn().mockImplementationOnce(() => new Promise<string>(r => { resolve = r; })).mockResolvedValue('fresh');
  const replay = createTerminalReplay(read, view);
  const first = replay.replay();
  for (let i = 0; i < 20; i++) void replay.replay(true);
  expect(read).toHaveBeenCalledOnce(); resolve('old'); await first;
  expect(read).toHaveBeenCalledTimes(2); expect(view.reset).toHaveBeenCalledOnce();
  read.mockImplementation(() => new Promise(() => {}));
  const pending = replay.replay(true); replay.dispose(); await pending;
  const count = view.write.mock.calls.length; replay.receive('late'); await replay.replay(); expect(view.write).toHaveBeenCalledTimes(count);
});
it('continues live output after a failed or empty retained read', async () => {
  const view = display(), read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('');
  const replay = createTerminalReplay(read, view); const first = replay.replay(); replay.receive('new'); await first;
  expect(view.write).toHaveBeenCalledExactlyOnceWith('new'); await replay.replay(true); expect(view.reset).toHaveBeenCalledOnce(); replay.dispose();
});
it('deduplicates sequenced events included in a snapshot without matching repeated text', async () => {
  let resolve!: (snapshot: { text: string; startOffset: number; endOffset: number }) => void;
  const view = display();
  const replay = createTerminalReplay(() => new Promise(r => { resolve = r; }), view);
  const reading = replay.replay();
  replay.receive('ha', { startOffset: 0, endOffset: 2 });
  replay.receive('haha', { startOffset: 2, endOffset: 6 });
  resolve({ text: 'haha', startOffset: 0, endOffset: 4 }); await reading;
  expect(view.write.mock.calls).toEqual([['haha'], ['ha']]);
  replay.receive('ha', { startOffset: 2, endOffset: 4 });
  expect(view.write).toHaveBeenCalledTimes(2);
  replay.receive('🙂', { startOffset: 6, endOffset: 8 });
  expect(view.write).toHaveBeenLastCalledWith('🙂'); replay.dispose();
});
it('repairs a live sequence gap by reading a snapshot without replaying input', async () => {
  const read = vi.fn().mockResolvedValueOnce({ text: 'a', startOffset: 0, endOffset: 1 })
    .mockResolvedValue({ text: 'abc', startOffset: 0, endOffset: 3 });
  const view = display(), replay = createTerminalReplay(read, view);
  await replay.replay(); replay.receive('c', { startOffset: 2, endOffset: 3 });
  await vi.waitFor(() => expect(view.write).toHaveBeenCalledTimes(2));
  expect(view.reset).not.toHaveBeenCalled();
  expect(view.write.mock.calls).toEqual([['a'], ['bc']]); replay.dispose();
});
it('marks a real gap if snapshot recovery fails and validates untrusted cursors', async () => {
  const read = vi.fn().mockResolvedValueOnce({ text: 'a', startOffset: 0, endOffset: 1 }).mockRejectedValue(new Error('offline'));
  const view = display(), replay = createTerminalReplay(read, view);
  await replay.replay(); replay.receive('c', { startOffset: 2, endOffset: 3 });
  await vi.waitFor(() => expect(view.write).toHaveBeenLastCalledWith('c'));
  expect(view.write.mock.calls[1]).toEqual(['\r\n[Some output was missed while reconnecting.]\r\n']);
  replay.receive('x', { startOffset: -1, endOffset: 9 });
  expect(view.write).toHaveBeenLastCalledWith('x');
  read.mockResolvedValue({ text: 'bad', startOffset: 10, endOffset: 0 });
  await replay.replay(true); expect(view.reset).not.toHaveBeenCalled(); replay.dispose();
});
it('bounds pending event count and bytes while preserving cursor overlap', async () => {
  let resolve!: (snapshot: { text: string; startOffset: number; endOffset: number }) => void;
  const view = display(), replay = createTerminalReplay(() => new Promise(r => { resolve = r; }), view, 3);
  const first = replay.replay(); replay.receive('abcde', { startOffset: 0, endOffset: 5 });
  resolve({ text: 'abcd', startOffset: 0, endOffset: 4 }); await first;
  expect(view.write.mock.calls).toEqual([['abcd'], ['e']]); replay.dispose();
  const bounded = createTerminalReplay(() => new Promise(r => { resolve = r; }), view, 10000);
  const second = bounded.replay();
  for (let i = 0; i < 4100; i++) bounded.receive('x', { startOffset: i, endOffset: i + 1 });
  bounded.receive('', { startOffset: 4100, endOffset: 4100 });
  resolve({ text: '', startOffset: 4100, endOffset: 4100 }); await second;
  expect(view.write).toHaveBeenCalledTimes(2); bounded.dispose();
});

const snap = (text: string, startOffset: number) => ({ text, startOffset, endOffset: startOffset + text.length });
it('refreshes without resetting when nothing was missed', async () => {
  const read = vi.fn().mockResolvedValueOnce(snap('abc', 0)).mockResolvedValue(snap('abc', 0));
  const view = display(), replay = createTerminalReplay(read, view);
  await replay.replay(); view.follow.mockClear();
  replay.receive('d', { startOffset: 3, endOffset: 4 });
  await replay.replay(true);
  expect(view.reset).not.toHaveBeenCalled(); expect(view.follow).not.toHaveBeenCalled();
  expect(view.write.mock.calls).toEqual([['abc'], ['d']]); replay.dispose();
});
it('appends only the missed tail when the window still covers the offset', async () => {
  const read = vi.fn().mockResolvedValueOnce(snap('abc', 0)).mockResolvedValue(snap('bcdef', 1));
  const view = display(), replay = createTerminalReplay(read, view);
  await replay.replay(); await replay.replay(true);
  expect(view.reset).not.toHaveBeenCalled(); expect(view.write.mock.calls).toEqual([['abc'], ['def']]); replay.dispose();
});
it('resets, captures the viewport and follows with it when the window no longer covers the offset', async () => {
  const read = vi.fn().mockResolvedValueOnce(snap('abc', 0)).mockResolvedValue(snap('xyz', 10));
  const viewport = { following: false, distanceFromBottom: 4 };
  const view = { ...display(), capture: vi.fn(() => viewport) }, replay = createTerminalReplay(read, view);
  await replay.replay(); await replay.replay(true);
  expect(view.capture).toHaveBeenCalledOnce(); expect(view.reset).toHaveBeenCalledOnce();
  expect(view.write).toHaveBeenLastCalledWith('xyz'); expect(view.follow).toHaveBeenLastCalledWith(viewport); replay.dispose();
});
it('resets for a legacy string snapshot', async () => {
  const read = vi.fn().mockResolvedValueOnce(snap('abc', 0)).mockResolvedValue('legacy');
  const view = display(), replay = createTerminalReplay(read, view);
  await replay.replay(); await replay.replay(true);
  expect(view.reset).toHaveBeenCalledOnce(); expect(view.follow).toHaveBeenLastCalledWith(undefined); replay.dispose();
});
