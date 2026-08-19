import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readProjectSnapshot } from './project-reader.js';

describe('readProjectSnapshot', () => {
  it('supports legacy arrays and current project envelopes without throwing on absent data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-project-reader-'));
    await expect(readProjectSnapshot(root)).resolves.toEqual([]);
    writeFileSync(join(root, 'projects.json'), JSON.stringify([{ id: 'one' }]));
    await expect(readProjectSnapshot(root)).resolves.toEqual([{ id: 'one' }]);
    writeFileSync(join(root, 'projects.json'), JSON.stringify({ version: 1, projects: [{ id: 'two' }] }));
    await expect(readProjectSnapshot(root)).resolves.toEqual([{ id: 'two' }]);
  });
});
