import { describe, expect, it } from 'vitest';
import { createCoalescedRunner } from './coalesced-runner.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined;
  const promise = new Promise<void>((next) => {
    resolve = () => next();
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe('createCoalescedRunner', () => {
  it('runs the first call and coalesces overlaps into one follow-up', async () => {
    const first = deferred();
    const second = deferred();
    let starts = 0;
    const runner = createCoalescedRunner(async () => {
      starts += 1;
      if (starts === 1) {
        await first.promise;
        return;
      }
      await second.promise;
    });

    runner.run();
    runner.run();
    runner.run();
    expect(starts).toBe(1);

    first.resolve();
    await flush();
    expect(starts).toBe(2);

    second.resolve();
    await flush();
    expect(starts).toBe(2);
    runner.dispose();
  });

  it('does not start a queued follow-up after dispose', async () => {
    const first = deferred();
    let starts = 0;
    const runner = createCoalescedRunner(async () => {
      starts += 1;
      await first.promise;
    });

    runner.run();
    runner.run();
    expect(starts).toBe(1);
    runner.dispose();
    first.resolve();
    await flush();
    expect(starts).toBe(1);
  });

  it('ignores run() after dispose', async () => {
    let starts = 0;
    const runner = createCoalescedRunner(async () => {
      starts += 1;
    });
    runner.dispose();
    runner.run();
    await flush();
    expect(starts).toBe(0);
  });
});
