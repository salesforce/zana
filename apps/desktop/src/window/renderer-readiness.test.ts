import { describe, expect, it, vi } from 'vitest';
import { RendererReadiness } from './renderer-readiness.js';

describe('RendererReadiness', () => {
  it('waits for the matching renderer acknowledgement', async () => {
    const readiness = new RendererReadiness();
    let settled = false;
    const waiting = readiness.wait(1, 1_000).then((result) => {
      settled = true;
      return result;
    });
    readiness.markReady(2);
    await Promise.resolve();
    expect(settled).toBe(false);
    readiness.markReady(1);
    await expect(waiting).resolves.toBe(true);
  });

  it('resets navigation readiness and resolves removal as unavailable', async () => {
    const readiness = new RendererReadiness();
    readiness.markReady(1);
    await expect(readiness.wait(1, 1)).resolves.toBe(true);
    readiness.reset(1);
    const waiting = readiness.wait(1, 1_000);
    readiness.remove(1);
    await expect(waiting).resolves.toBe(false);
  });

  it('times out instead of hanging forever', async () => {
    vi.useFakeTimers();
    const readiness = new RendererReadiness();
    const waiting = readiness.wait(1, 250);
    await vi.advanceTimersByTimeAsync(250);
    await expect(waiting).resolves.toBe(false);
    vi.useRealTimers();
  });
});
