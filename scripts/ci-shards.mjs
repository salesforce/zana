import { readFileSync } from 'node:fs';

export const testDurations = JSON.parse(readFileSync(new URL('./ci-test-durations.json', import.meta.url), 'utf8'));

export function parseShard(value) {
  if (!/^[1-9]\d*\/[1-9]\d*$/.test(value) || value.includes('\n')) return null;
  const [index, count] = value.split('/').map(Number);
  return index <= count && count <= 64 ? { index, count } : null;
}

/**
 * Longest-first packing; ties use paths so every independent runner agrees.
 * @template T
 * @param {T[]} items
 * @param {number} count
 * @param {(item: T) => string} key
 * @param {(item: T) => number} duration
 * @returns {T[][]}
 */
export function balancedShards(items, count, key, duration) {
  if (!Number.isInteger(count) || count < 1 || count > 64) throw new Error('Invalid shard count');
  const shards = Array.from({ length: count }, () => ({ items: [], total: 0 }));
  const weighted = items.map(item => ({ item, key: key(item), weight: Math.max(1, duration(item)) }));
  weighted.sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const { item, weight } of weighted) {
    const target = shards.reduce((best, shard) => shard.total < best.total ? shard : best);
    target.items.push(item);
    target.total += weight;
  }
  return shards.map(shard => shard.items);
}
