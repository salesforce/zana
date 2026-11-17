import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPersonas } from './store-readers.js';

describe('readPersonas', () => {
  it('reads project personas with their project source and labels dropped files by project', () => {
    const root = mkdtempSync(join(tmpdir(), 'cli-personas-'));
    const projectDir = join(root, 'proj', '.zcc', 'personas');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'ok.json'), JSON.stringify({ id: 'p', name: 'P' }));
    writeFileSync(join(projectDir, 'bad.json'), JSON.stringify({ id: 'q', name: 'Q', modelLevel: 'huge' }));
    const project = { id: 'p1', name: 'Proj', path: join(root, 'proj') } as never;
    const { data, warnings } = readPersonas(join(root, 'data'), [project]);
    expect(data).toEqual([{ id: 'p', name: 'P', source: { projectId: 'p1', projectName: 'Proj' } }]);
    expect(warnings).toEqual(['Proj/personas/bad.json: dropped (bad-model-level)']);
  });

  it('reports an unreadable entry without throwing', () => {
    const root = mkdtempSync(join(tmpdir(), 'cli-personas-'));
    mkdirSync(join(root, 'personas', 'dir.json'), { recursive: true });
    const { data, warnings } = readPersonas(root, []);
    expect(data).toEqual([]);
    expect(warnings).toEqual(['personas/dir.json: unreadable, skipped']);
  });
});
