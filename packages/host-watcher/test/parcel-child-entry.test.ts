import fs from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  parcel: {},
  handleMessage: vi.fn(),
  dispose: vi.fn(async () => undefined),
  createHandler: vi.fn(),
  disposeThenExit: vi.fn(),
}));
vi.mock('../src/real-parcel-watcher.js', () => ({ realParcelWatcher: fixture.parcel }));
vi.mock('../src/parcel-subprocess/parcel-child-handler.js', () => ({
  createParcelChildHandler: fixture.createHandler,
  disposeThenExit: fixture.disposeThenExit,
}));
const originalSend = Object.getOwnPropertyDescriptor(process, 'send');
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  if (originalSend) Object.defineProperty(process, 'send', originalSend);
  else Reflect.deleteProperty(process, 'send');
});

it('forwards IPC and filesystem access, and bounds disposal after parent disconnect', async () => {
  vi.resetModules();
  fixture.createHandler.mockReturnValue({ handleMessage: fixture.handleMessage, dispose: fixture.dispose });
  const listeners = new Map<string, (...args: any[]) => void>();
  const originalOn = process.on.bind(process);
  vi.spyOn(process, 'on').mockImplementation(((event: string, listener: (...args: any[]) => void) => {
    if (event === 'message' || event === 'disconnect') {
      listeners.set(event, listener);
      return process;
    }
    return originalOn(event as never, listener);
  }) as typeof process.on);
  const send = vi.fn();
  Object.defineProperty(process, 'send', { configurable: true, value: send });
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  vi.spyOn(fs, 'readdir').mockResolvedValue(['entry'] as never);

  await import('../src/parcel-subprocess/parcel-child-entry.js');
  expect(send).toHaveBeenCalledWith({ kind: 'ready' });
  const options = fixture.createHandler.mock.calls[0]![0];
  expect(options.parcel).toBe(fixture.parcel);
  expect(await options.listEntries('/workspace')).toEqual(['entry']);
  expect(fs.readdir).toHaveBeenCalledWith('/workspace');
  options.send({ kind: 'response', id: 'request-1' });
  expect(send).toHaveBeenLastCalledWith({ kind: 'response', id: 'request-1' });
  const message = { kind: 'subscribe', id: 'subscription-1' };
  listeners.get('message')!(message);
  expect(fixture.handleMessage).toHaveBeenCalledWith(message);

  listeners.get('disconnect')!();
  expect(fixture.disposeThenExit).toHaveBeenCalledWith(expect.objectContaining({ deadlineMs: 2_000 }));
  const shutdown = fixture.disposeThenExit.mock.calls[0]![0];
  await shutdown.dispose();
  expect(fixture.dispose).toHaveBeenCalledOnce();
  shutdown.exit();
  expect(exit).toHaveBeenCalledWith(0);

  Object.defineProperty(process, 'send', { configurable: true, value: undefined });
  expect(() => options.send({ kind: 'ready' })).not.toThrow();
});
