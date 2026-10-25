import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureBrowserOverlaySnapshot } from './browser-overlay-snapshot.js';

afterEach(() => vi.useRealTimers());
const image = () => ({ isEmpty: () => false, toJPEG: vi.fn(() => Buffer.from('page')) });

describe('browser overlay snapshot', () => {
  it('publishes the page before hiding the native view', async () => {
    const order: string[] = [];
    const page = image();
    captureBrowserOverlaySnapshot({ capture: async () => page, publish: url => order.push(url), hide: () => order.push('hide') });
    await Promise.resolve();
    expect(order).toEqual(['data:image/jpeg;base64,cGFnZQ==', 'hide']);
    expect(page.toJPEG).toHaveBeenCalledWith(80);
  });

  it.each(['empty', 'large', 'rejected', 'throws', 'encode'] as const)('still hides on %s capture without publishing a broken image', async failure => {
    const publish = vi.fn(), hide = vi.fn();
    captureBrowserOverlaySnapshot({ capture: () => {
      if (failure === 'throws') throw Error('closed');
      if (failure === 'rejected') return Promise.reject(Error('closed'));
      return Promise.resolve({ isEmpty: () => failure === 'empty', toJPEG: () => {
        if (failure === 'encode') throw Error('encode');
        return Buffer.alloc(8_388_608);
      } });
    }, publish, hide });
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
    expect(hide).toHaveBeenCalledOnce();
  });

  it('caps the wait and discards captures that finish after the deadline', async () => {
    vi.useFakeTimers();
    let resolve!: (value: ReturnType<typeof image>) => void;
    const publish = vi.fn(), hide = vi.fn();
    captureBrowserOverlaySnapshot({ capture: () => new Promise(done => { resolve = done; }), publish, hide });
    await vi.advanceTimersByTimeAsync(250);
    expect(hide).toHaveBeenCalledOnce();
    resolve(image()); await Promise.resolve();
    expect(publish).not.toHaveBeenCalled(); expect(hide).toHaveBeenCalledOnce();
  });

  it('cancels pending capture and its timer when the page is restored or closed', async () => {
    vi.useFakeTimers();
    let resolve!: (value: ReturnType<typeof image>) => void;
    const publish = vi.fn(), hide = vi.fn();
    const cancel = captureBrowserOverlaySnapshot({ capture: () => new Promise(done => { resolve = done; }), publish, hide });
    cancel(); resolve(image()); await vi.runAllTimersAsync();
    expect(publish).not.toHaveBeenCalled(); expect(hide).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
