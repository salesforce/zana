import { describe, expect, it } from 'vitest';
import { sortCatalogueByName } from './catalogue-sort.js';

describe('sortCatalogueByName', () => {
  it('copies frozen input and preserves each item identity', () => {
    const beta = Object.freeze({ id: 'beta', name: 'Beta' });
    const alpha = Object.freeze({ id: 'alpha', name: 'Alpha' });
    const items = Object.freeze([beta, alpha]);

    const result = sortCatalogueByName(items);

    expect(result).toEqual([alpha, beta]);
    expect(result).not.toBe(items);
    expect(result[0]).toBe(alpha);
    expect(result[1]).toBe(beta);
    expect(items).toEqual([beta, alpha]);
  });

  it('returns independent arrays for empty and singleton catalogues', () => {
    const item = { id: 'only', name: 'Only' };
    const empty: readonly typeof item[] = [];
    const singleton = [item] as const;

    expect(sortCatalogueByName(empty)).toEqual([]);
    expect(sortCatalogueByName(empty)).not.toBe(empty);
    expect(sortCatalogueByName(singleton)).toEqual([item]);
    expect(sortCatalogueByName(singleton)).not.toBe(singleton);
    expect(sortCatalogueByName(singleton)[0]).toBe(item);
  });

  it('orders mixed case, accents, and numeric name segments naturally', () => {
    const items = [
      { id: 'z', name: 'Zebra 10' },
      { id: 'a', name: 'alpha 2' },
      { id: 'b', name: 'Alpha 10' },
      { id: 'c', name: 'Álpha 1' },
    ];

    expect(sortCatalogueByName(items).map(({ name }) => name)).toEqual([
      'Álpha 1',
      'alpha 2',
      'Alpha 10',
      'Zebra 10',
    ]);
  });

  it('breaks equal-name ties by exact ID', () => {
    const items = [
      { id: 'z-last', name: 'Same' },
      { id: 'a-first', name: 'Same' },
      { id: 'm-middle', name: 'Same' },
    ];

    expect(sortCatalogueByName(items).map(({ id }) => id)).toEqual([
      'a-first',
      'm-middle',
      'z-last',
    ]);
  });

  it('allows duplicate exact IDs without replacing either item', () => {
    const first = { id: 'same', name: 'Same' };
    const second = { id: 'same', name: 'Same' };

    expect(sortCatalogueByName([second, first])).toEqual([second, first]);
  });
});
