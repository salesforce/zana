export const STAR_BANNER_STORAGE_KEY = 'zcc-star-dismissed';

export function isStarBannerDismissed(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try {
    return storage?.getItem(STAR_BANNER_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissStarBanner(storage: Pick<Storage, 'setItem'> | null | undefined): void {
  try {
    storage?.setItem(STAR_BANNER_STORAGE_KEY, '1');
  } catch {
    /* private mode / disabled storage */
  }
}
