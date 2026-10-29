import { expect, it } from 'vitest';
import { balancedShards, parseShard } from './ci-shards.mjs';
import DurationSequencer from './ci-unit-sequencer';
import type { TestSpecification, Vitest } from 'vitest/node';

it('packs longest files first deterministically without dropping or duplicating files', () => {
  const weights: Record<string, number> = { a: 90, b: 80, c: 30, d: 20, e: 10, f: 10 };
  const files = Object.keys(weights);
  const shard = (input: string[]) => balancedShards(input, 3, path => path, path => weights[path]);
  expect(shard(files)).toEqual([['a'], ['b'], ['c', 'd', 'e', 'f']]);
  expect(shard([...files].reverse())).toEqual(shard(files));
  expect(shard(files).flat().sort()).toEqual(files);
  expect(balancedShards([], 3, String, () => 1)).toEqual([[], [], []]);
  expect(balancedShards(['b', 'a'], 3, String, () => 0)).toEqual([['a'], ['b'], []]);
  for (const count of [0, -1, 1.5, 65, NaN]) expect(() => balancedShards([], count, String, () => 1)).toThrow('Invalid shard count');
});

it('validates bounded shard indexes including indexes past the last shard', () => {
  expect(parseShard('2/3')).toEqual({ index: 2, count: 3 });
  expect(parseShard('1/1')).toEqual({ index: 1, count: 1 });
  for (const value of ['', '0/3', '4/3', '1/65', '1.5/3', '1/0', '01/3', '1/3\n']) expect(parseShard(value)).toBeNull();
});

it('balances serial and parallel projects separately and retains Vitest sorting', async () => {
  const spec = (path: string, name: string) => ({ moduleId: `/repo/${path}`, project: { name } }) as TestSpecification;
  const files = [spec('a.test.ts', 'serial'), spec('b.test.ts', 'serial'), spec('c.test.ts', 'parallel'), spec('d.test.ts', 'parallel')];
  const shards = await Promise.all([1, 2, 3].map(index => new DurationSequencer({ config: { root: '/repo', shard: { index, count: 3 } } } as Vitest).shard(files)));
  expect(shards.map(files => files.length)).toEqual([2, 2, 0]);
  expect(new Set(shards.flat())).toEqual(new Set(files));
  const known = spec('e2e/unknown.test.ts', 'parallel');
  expect(await new DurationSequencer({ config: { root: '/repo', shard: { index: 1, count: 1 } } } as Vitest).shard([known])).toEqual([known]);
});
