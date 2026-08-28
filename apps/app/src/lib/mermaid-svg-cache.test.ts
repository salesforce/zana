import { afterEach, describe, expect, it } from 'vitest';
import {
  MERMAID_SVG_CACHE_LIMIT,
  mermaidSvgCacheKey,
  readMermaidSvgCache,
  resetMermaidSvgCache,
  writeMermaidSvgCache
} from './mermaid-svg-cache.js';

afterEach(() => {
  resetMermaidSvgCache();
});

describe('mermaidSvgCache', () => {
  it('returns the last SVG for the same theme and source', () => {
    const key = mermaidSvgCacheKey('dark', 'graph TD; A-->B');
    expect(readMermaidSvgCache(key)).toBeUndefined();
    writeMermaidSvgCache(key, '<svg>ok</svg>');
    expect(readMermaidSvgCache(key)).toBe('<svg>ok</svg>');
  });

  it('evicts the oldest entry when the cap is exceeded', () => {
    for (let index = 0; index < MERMAID_SVG_CACHE_LIMIT; index += 1) {
      writeMermaidSvgCache(`k${index}`, `svg-${index}`);
    }
    writeMermaidSvgCache('newest', 'svg-new');
    expect(readMermaidSvgCache('k0')).toBeUndefined();
    expect(readMermaidSvgCache('newest')).toBe('svg-new');
    expect(readMermaidSvgCache(`k${MERMAID_SVG_CACHE_LIMIT - 1}`)).toBe(
      `svg-${MERMAID_SVG_CACHE_LIMIT - 1}`
    );
  });

  it('distinguishes theme in the cache key', () => {
    expect(mermaidSvgCacheKey('dark', 'A')).not.toBe(mermaidSvgCacheKey('default', 'A'));
  });
});
