/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';
import { copyText, copyViaTextarea } from './app/clipboard.js';

describe('clipboard', () => {
  it('uses navigator.clipboard when it succeeds', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => undefined) } });
    await expect(copyText('hello')).resolves.toBe(true);
    vi.unstubAllGlobals();
  });

  it('falls back to a textarea when clipboard write fails', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('denied');
        })
      }
    });
    document.execCommand = vi.fn(() => true) as typeof document.execCommand;
    await expect(copyText('hello')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    vi.unstubAllGlobals();
  });

  it('returns false when execCommand throws', () => {
    document.execCommand = vi.fn(() => {
      throw new Error('blocked');
    }) as typeof document.execCommand;
    expect(copyViaTextarea('x')).toBe(false);
  });
});
