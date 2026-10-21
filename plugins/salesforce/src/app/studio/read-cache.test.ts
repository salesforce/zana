import { afterEach, describe, expect, it } from 'vitest';
import { cachedRead, clearReadCache, readCacheKey, rememberRead } from './read-cache.js';

afterEach(clearReadCache);

describe('read cache', () => {
  it('keys by plugin, project, kind and ref', () => {
    expect(readCacheKey('sf', undefined, 'lwc', 'c/a')).toBe(readCacheKey('sf', '', 'lwc', 'c/a'));
    expect(readCacheKey('sf', 'p1', 'lwc', 'c/a')).not.toBe(readCacheKey('sf', 'p1', 'lightning-type', 'c/a'));
  });
  it('keeps the 32 most recently remembered answers', () => {
    for (let i = 0; i < 33; i++) rememberRead(`k${i}`, i);
    expect(cachedRead('k0')).toBeUndefined();
    expect(cachedRead('k1')).toBe(1);
    // Remembering again makes an answer the newest.
    rememberRead('k1', 'again');
    rememberRead('k33', 33);
    expect(cachedRead('k1')).toBe('again');
    expect(cachedRead('k2')).toBeUndefined();
  });
});
