import { describe, it, expect } from 'vitest';
import { buildShelves } from '../taskShelves.js';

const files = [
  { path: '/p/a.ts', op: 'R' }, { path: '/p/a.ts', op: 'R' }, // dupe
  { path: '/p/b.ts', op: 'W' }, { path: '/p/c.ts', op: 'C' }
] as any;

describe('buildShelves', () => {
  it('routes R→sources, C/W→outputs, deduped by path', () => {
    const shelves = buildShelves({ files, subagentCount: 0, session: {} as any });
    const sources = shelves.find((s) => s.id === 'sources')!;
    const outputs = shelves.find((s) => s.id === 'outputs')!;
    expect(sources.rows.map((r) => r.title)).toEqual(['/p/a.ts']);
    expect(outputs.rows.map((r) => r.title).sort()).toEqual(['/p/b.ts', '/p/c.ts']);
  });
  it('adds a subagents background row when count>0', () => {
    const shelves = buildShelves({ files: [], subagentCount: 3, session: {} as any });
    const bg = shelves.find((s) => s.id === 'background')!;
    expect(bg.rows.some((r) => /3/.test(r.title + (r.detail ?? '')))).toBe(true);
  });
  it('adds a working stream row when agentState is working', () => {
    const shelves = buildShelves({ files: [], subagentCount: 0, agentState: 'working', session: {} as any });
    expect(shelves.find((s) => s.id === 'background')!.rows.length).toBeGreaterThan(0);
  });
  it('caps rows with a +K more overflow row', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ path: `/p/${i}.ts`, op: 'R' })) as any;
    const sources = buildShelves({ files: many, subagentCount: 0, session: {} as any })
      .find((s) => s.id === 'sources')!;
    expect(sources.rows.some((r) => /more/i.test(r.title))).toBe(true);
  });
  it('empty input → all shelves present with empty rows', () => {
    const shelves = buildShelves({ files: [], subagentCount: 0, session: {} as any });
    expect(shelves.map((s) => s.id).sort()).toEqual(['background', 'outputs', 'sources']);
    expect(shelves.every((s) => Array.isArray(s.rows))).toBe(true);
  });
});
