/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { FRAME_GUARD_CLASS, guardEmbeddedFrames } from './frameGuard.js';

describe('guardEmbeddedFrames', () => {
  it('keeps the guard while any holder remains and releases idempotently', () => {
    const first = guardEmbeddedFrames();
    const second = guardEmbeddedFrames();
    expect(document.body.classList.contains(FRAME_GUARD_CLASS)).toBe(true);
    first();
    first();
    expect(document.body.classList.contains(FRAME_GUARD_CLASS)).toBe(true);
    second();
    expect(document.body.classList.contains(FRAME_GUARD_CLASS)).toBe(false);
  });
});
