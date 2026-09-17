import { afterEach, describe, expect, it } from 'vitest';
import {
  MERMAID_SVG_CACHE_LIMIT,
  loadMermaidSvg,
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

  it('coalesces concurrent loads for the same key and serializes distinct keys', async () => {
    let active = 0;
    let maxActive = 0;
    const started: string[] = [];
    const load = (id: string, delay = 0) => async () => {
      started.push(id);
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        return `<svg>${id}</svg>`;
      } finally {
        active -= 1;
      }
    };

    const first = loadMermaidSvg('same', load('a', 20));
    const second = loadMermaidSvg('same', load('b', 20));
    const other = loadMermaidSvg('other', load('c', 20));
    expect(await first).toBe('<svg>a</svg>');
    expect(await second).toBe('<svg>a</svg>');
    expect(await other).toBe('<svg>c</svg>');
    expect(started).toEqual(['a', 'c']);
    expect(maxActive).toBe(1);
    expect(readMermaidSvgCache('same')).toBe('<svg>a</svg>');
  });
});
