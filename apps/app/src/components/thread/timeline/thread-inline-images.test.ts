import { describe, expect, it } from 'vitest';
import {
  extractInlineThreadImages,
  isDiskImagePath,
  isSafeImageDataUrl,
  shouldLiftMarkdownImageSrc,
  threadImageStubLabel,
  transformMarkdownMediaUrl
} from './thread-inline-images.js';

describe('thread inline images', () => {
  it('recognizes displayable data URLs and disk paths', () => {
    expect(isSafeImageDataUrl('data:image/png;base64,abc')).toBe(true);
    expect(isSafeImageDataUrl('data:image/svg+xml;charset=utf-8,<svg/>')).toBe(true);
    expect(isSafeImageDataUrl('data:text/html;base64,abc')).toBe(false);
    expect(isDiskImagePath('/tmp/shot.png')).toBe(true);
    expect(isDiskImagePath('C:\\tmp\\shot.png')).toBe(true);
    expect(isDiskImagePath('file:///tmp/shot.png')).toBe(true);
    expect(isDiskImagePath('shot-1.png')).toBe(false);
    expect(isDiskImagePath('/tmp/notes.ts')).toBe(false);
  });

  it('keeps inline-renderable markdown images in the body', () => {
    expect(shouldLiftMarkdownImageSrc('data:image/png;base64,xx')).toBe(false);
    expect(shouldLiftMarkdownImageSrc('https://example.com/a.png')).toBe(false);
    expect(shouldLiftMarkdownImageSrc('/tmp/shot.png')).toBe(true);
    expect(shouldLiftMarkdownImageSrc('file:///tmp/shot.png')).toBe(true);
  });

  it('does not dump data URLs or long paths as stub labels', () => {
    expect(threadImageStubLabel('data:image/png;base64,aaaa')).toBe('Image');
    expect(threadImageStubLabel('/tmp/shot.png')).toBe('shot.png');
    expect(threadImageStubLabel(`file:///tmp/${'a'.repeat(80)}.png`).endsWith('…')).toBe(true);
  });

  it('lifts dumped paths and base64 out of message text', () => {
    const data = 'data:image/png;base64,iVBORw0KGgo=';
    const lifted = extractInlineThreadImages(`see this\n${data}\n![alt](/tmp/shot.png)`);
    expect(lifted.text).toBe('see this');
    expect(lifted.images).toEqual([
      { src: '/tmp/shot.png', alt: 'alt' },
      { src: data, alt: 'Image' }
    ]);

    const kept = extractInlineThreadImages(`![cat](${data})\n![web](https://example.com/a.png)`);
    expect(kept.text).toContain('![cat]');
    expect(kept.text).toContain('![web]');
    expect(kept.images).toEqual([]);
  });

  it('allows data and blob image URLs through the markdown transform', () => {
    const deny = () => '';
    expect(transformMarkdownMediaUrl('data:image/png;base64,xx', deny))
      .toBe('data:image/png;base64,xx');
    expect(transformMarkdownMediaUrl('blob:shot', deny)).toBe('blob:shot');
    expect(transformMarkdownMediaUrl('zcc-thread:thr_1', deny)).toBe('zcc-thread:thr_1');
    expect(transformMarkdownMediaUrl('javascript:alert(1)', deny)).toBe('');
    expect(transformMarkdownMediaUrl('https://example.com/a.png', (url) => url))
      .toBe('https://example.com/a.png');
  });
});
