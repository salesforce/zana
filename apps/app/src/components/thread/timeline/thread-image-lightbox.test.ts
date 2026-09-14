import { describe, expect, it } from 'vitest';
import {
  mergeLightboxItems,
  resolveLightboxSelection
} from './thread-image-lightbox.js';

describe('resolveLightboxSelection', () => {
  const items = [
    { src: 'a.png', alt: 'A' },
    { src: 'b.png', alt: 'B' },
    { src: 'c.png', alt: 'C' }
  ];

  it('keeps the selected src when the gallery mutates around it', () => {
    expect(resolveLightboxSelection(items, 'b.png')).toEqual(items[1]);
    expect(resolveLightboxSelection([items[1], items[2], { src: 'd.png', alt: 'D' }], 'b.png'))
      .toEqual(items[1]);
  });

  it('clamps to the last item when the selection disappears', () => {
    expect(resolveLightboxSelection(items.slice(0, 2), 'c.png')).toEqual(items[1]);
    expect(resolveLightboxSelection([], 'a.png')).toBeNull();
  });
});

describe('mergeLightboxItems', () => {
  it('dedupes by src and appends an extra item', () => {
    expect(
      mergeLightboxItems(
        [{ src: 'a.png', alt: 'A' }, { src: 'a.png', alt: 'dup' }],
        { src: 'b.png', alt: 'B' }
      )
    ).toEqual([
      { src: 'a.png', alt: 'A' },
      { src: 'b.png', alt: 'B' }
    ]);
  });
});
