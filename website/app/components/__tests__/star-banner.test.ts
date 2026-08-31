import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { site } from '../../../lib/site.ts';
import {
  dismissStarBanner,
  isStarBannerDismissed,
  STAR_BANNER_STORAGE_KEY
} from '../star-banner.ts';

const COMPONENTS = dirname(fileURLToPath(new URL('../star-banner.ts', import.meta.url)));

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = { ...initial };
  return {
    get length() {
      return Object.keys(data).length;
    },
    clear() {
      for (const key of Object.keys(data)) delete data[key];
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    key() {
      return null;
    },
    removeItem(key: string) {
      delete data[key];
    },
    setItem(key: string, value: string) {
      data[key] = value;
    }
  };
}

describe('star banner dismiss state', () => {
  it('starts visible when storage is empty', () => {
    expect(isStarBannerDismissed(memoryStorage())).toBe(false);
  });

  it('treats a missing storage as not dismissed', () => {
    expect(isStarBannerDismissed(null)).toBe(false);
  });

  it('persists dismiss and hides on the next read', () => {
    const storage = memoryStorage();
    dismissStarBanner(storage);
    expect(storage.getItem(STAR_BANNER_STORAGE_KEY)).toBe('1');
    expect(isStarBannerDismissed(storage)).toBe(true);
  });

  it('survives storage that throws', () => {
    const throwing = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      }
    };
    expect(isStarBannerDismissed(throwing)).toBe(false);
    expect(() => dismissStarBanner(throwing)).not.toThrow();
  });

  it('points the CTA at the public repo', () => {
    expect(site.repo).toBe('https://github.com/salesforce/zana');
    const banner = readFileSync(join(COMPONENTS, 'StarBanner.tsx'), 'utf8');
    expect(banner).toContain('href={site.repo}');
    const layout = readFileSync(join(COMPONENTS, '../layout.tsx'), 'utf8');
    expect(layout).toContain('<StarBanner />');
  });
});
