import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTerminalWriteQueue } from './terminal-write-queue.js';
let frames: Map<number, FrameRequestCallback>, next: number;
let queues: Array<ReturnType<typeof createTerminalWriteQueue>>;
beforeEach(() => {
  frames = new Map(); next = 0; queues = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { queues.forEach(queue => queue.dispose()); vi.unstubAllGlobals(); });
const frame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); };
const make = (write: (text: string, done: () => void) => void, visible = true) => { const queue = createTerminalWriteQueue(write, visible); queues.push(queue); return queue; };
it('does not parse hidden streams, bounds retained pending output and marks omissions', () => {
  const write = vi.fn((_text, done) => done()); const queue = make(write, false);
  queue.write('x'.repeat(500000)); expect(frames.size).toBe(0); expect(write).not.toHaveBeenCalled();
  queue.setVisible(true); frame(); expect(write.mock.calls[0][0]).toContain('omitted');
  expect(write.mock.calls[0][0].length).toBeLessThan(17000);
  queue.dispose(); queue.write('late'); expect(frames.size).toBe(0);
});
it('waits for parser completion, limits concurrent writes and releases disposed writers', () => {
  const callbacks: Array<() => void> = []; const write = vi.fn((_text, done) => callbacks.push(done));
  const a = make(write), b = make(write), c = make(write);
  [a, b, c].forEach(queue => queue.write('a'.repeat(40000))); frame(); expect(write).toHaveBeenCalledTimes(2);
  frame(); expect(write).toHaveBeenCalledTimes(2);
  a.dispose(); b.dispose(); frame(); expect(write).toHaveBeenCalledTimes(3);
  callbacks.forEach(done => done()); frame(); expect(write.mock.calls.every(([text]) => text.length <= 16384)).toBe(true);
});
it('orders reset after an in-flight write and tolerates parser failures', () => {
  let done!: () => void; const order: string[] = [];
  const queue = make((text, callback) => { order.push(text); done = callback; });
  queue.write('old'); frame(); queue.reset(() => order.push('reset')); queue.write('new');
  expect(order).toEqual(['old']); done(); frame(); expect(order).toEqual(['old', 'reset', 'new']); done();
  const throwing = make(() => { throw new Error('disposed parser'); }); throwing.write('x'); frame();
});
it('bounds aggregate pending history and favors visible sessions', () => {
  const writes: string[] = []; const all = Array.from({ length: 40 }, () => make((text, done) => { writes.push(text); done(); }, false));
  all.forEach(queue => queue.write('x'.repeat(256 * 1024)));
  all[0].setVisible(true); frame(); expect(writes[0]).toContain('omitted');
});
it('runs idle callbacks only once queued output has been parsed', () => {
  let done!: () => void; const idle = vi.fn();
  const queue = make((_text, callback) => { done = callback; });
  queue.whenIdle(idle); expect(idle).toHaveBeenCalledTimes(1);
  queue.write('abc'); queue.whenIdle(idle); expect(idle).toHaveBeenCalledTimes(1);
  frame(); expect(idle).toHaveBeenCalledTimes(1);
  done(); expect(idle).toHaveBeenCalledTimes(2);
  queue.write('def'); queue.whenIdle(idle); queue.dispose(); queue.whenIdle(idle); expect(idle).toHaveBeenCalledTimes(2);
});
const GAP_TEXT = 'omitted while this terminal was hidden or busy';
const drain = (writes: string[]) => { for (let i = 0; i < 40 && frames.size; i++) frame(); return writes.join(''); };
it('clearGap before setVisible(true) drops the pending marker and keeps the retained tail', () => {
  const writes: string[] = []; const queue = make((text, done) => { writes.push(text); done(); }, false);
  queue.write('x'.repeat(300000));
  queue.clearGap(); queue.setVisible(true); frame();
  expect(writes[0]).not.toContain(GAP_TEXT); expect(writes[0].startsWith('x')).toBe(true);
  expect(drain(writes)).not.toContain(GAP_TEXT); expect(writes.join('').length).toBe(256 * 1024);
});
it('prepends the marker on refocus when clearGap is not called', () => {
  const writes: string[] = []; const queue = make((text, done) => { writes.push(text); done(); }, false);
  queue.write('x'.repeat(300000)); queue.setVisible(true); frame();
  expect(writes[0].startsWith('\r\n[Some output was omitted')).toBe(true);
});
it('setVisible(true) only schedules and never writes synchronously', () => {
  const write = vi.fn((_text, done) => done()); const queue = make(write, false);
  queue.write('x'.repeat(300000)); queue.setVisible(true);
  expect(write).toHaveBeenCalledTimes(0); expect(frames.size).toBe(1);
  frame(); expect(write).toHaveBeenCalledTimes(1);
});
it('flag-only clearGap leaves aggregate byte accounting unchanged', () => {
  const writes: string[] = []; const sink = (text: string, done: () => void) => { writes.push(text); done(); };
  const first = make(sink, false);
  first.write('x'.repeat(300000)); first.clearGap();
  // 31 more full sessions bring the total to exactly the global cap: no drop yet.
  for (let i = 0; i < 31; i++) make(sink, false).write('y'.repeat(256 * 1024));
  // One extra byte crosses the cap exactly, so the oldest hidden session loses it and re-marks the gap.
  make(sink, false).write('z');
  writes.length = 0; first.setVisible(true); frame(); expect(writes[0]).toContain(GAP_TEXT);
});
it('clearGap after dispose is a no-op', () => {
  const write = vi.fn((_text, done) => done()); const queue = make(write, false);
  queue.write('x'.repeat(300000)); queue.dispose();
  expect(() => queue.clearGap()).not.toThrow(); queue.setVisible(true); frame(); expect(write).not.toHaveBeenCalled();
});
