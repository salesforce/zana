// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findHeading, headingSlug, onAnchorRequest, requestAnchor, takeAnchor } from './anchors.js';

describe('anchors', () => {
  afterEach(() => vi.useRealTimers());

  it('slugs headings like GitHub', () => {
    expect(headingSlug('Open Questions?')).toBe('open-questions');
    expect(headingSlug('  Détails & API v2 ')).toBe('détails--api-v2');
  });

  it('finds a heading by slug or by its text, including repeated headings', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h2>Goals</h2><h2>Notes</h2><h3>Notes</h3><p>x</p>';
    expect(findHeading(root, 'goals')?.textContent).toBe('Goals');
    expect(findHeading(root, 'Goals')?.textContent).toBe('Goals');
    expect(findHeading(root, 'notes-1')?.tagName).toBe('H3');
    expect(findHeading(root, 'missing')).toBeNull();
    expect(findHeading(root, '!!')).toBeNull();
  });

  it('hands a request to the matching file once, notifies listeners and ignores empty anchors', () => {
    const seen = vi.fn();
    const off = onAnchorRequest(seen);
    requestAnchor('d', 'a.md', '');
    expect(seen).not.toHaveBeenCalled();
    requestAnchor('d', 'a.md', 'goals');
    expect(seen).toHaveBeenCalledTimes(1);
    expect(takeAnchor('d', 'b.md')).toBeNull();
    expect(takeAnchor('d', 'a.md')).toBe('goals');
    expect(takeAnchor('d', 'a.md')).toBeNull();
    off();
  });

  it('drops a stale request', () => {
    vi.useFakeTimers();
    requestAnchor('d', 'a.md', 'goals');
    vi.advanceTimersByTime(6000);
    expect(takeAnchor('d', 'a.md')).toBeNull();
  });
});
