import { describe, expect, it } from 'vitest';
import { windowMenuTail } from './window-menu.js';

describe('windowMenuTail', () => {
  it('ends with Bring All to Front on macOS and never nests the window role', () => {
    const tail = windowMenuTail(true);
    expect(tail).toEqual([{ type: 'separator' }, { role: 'front' }]);
    expect(tail.some((item) => item.role === 'window')).toBe(false);
  });

  it('ends with Close elsewhere', () => {
    expect(windowMenuTail(false)).toEqual([{ role: 'close' }]);
  });
});
