import { describe, expect, it } from 'vitest';
import { getAppSurface, hasDesktopBridge } from '../app-surface.js';

describe('app surface', () => {
  it('treats a runtime without the desktop bridge as web', () => {
    expect(hasDesktopBridge()).toBe(false);
    expect(getAppSurface()).toBe('web');
  });
});
