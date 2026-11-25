import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForSessionExit } from './session-exit-wait.js';

afterEach(() => { vi.useRealTimers(); });

describe('waitForSessionExit', () => {
  it('resolves true at once for an absent session', async () => {
    const source = new EventEmitter();
    await expect(waitForSessionExit(source, () => false, 's1', 1000)).resolves.toBe(true);
    expect(source.listenerCount('exit')).toBe(0);
  });

  it('resolves true on the session exit event and ignores other sessions', async () => {
    const source = new EventEmitter();
    const wait = waitForSessionExit(source, () => true, 's1', 1000);
    source.emit('exit', 'other');
    expect(source.listenerCount('exit')).toBe(1);
    source.emit('exit', 's1');
    await expect(wait).resolves.toBe(true);
    expect(source.listenerCount('exit')).toBe(0);
  });

  it('resolves false after the bounded timeout and releases the listener', async () => {
    vi.useFakeTimers();
    const source = new EventEmitter();
    const wait = waitForSessionExit(source, () => true, 's1', 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(wait).resolves.toBe(false);
    expect(source.listenerCount('exit')).toBe(0);
  });
});
