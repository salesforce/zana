import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERSONA_FILE_SCAN_LIMIT, PERSONA_WARNING_LIMIT, readPersonaDir } from './persona-warnings.js';

describe('readPersonaDir', () => {
  it('returns nothing for a missing directory', () => {
    expect(readPersonaDir(join(tmpdir(), 'no-such-personas-dir'), 'user')).toEqual({ personas: [], warnings: [] });
  });

  it('ignores non-JSON files, keeps valid personas quiet, and tolerates a newer reasoningLevel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'persona-warnings-'));
    writeFileSync(join(dir, 'notes.txt'), 'x');
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ id: 'a', name: 'A', reasoningLevel: 'from-the-future' }));
    expect(readPersonaDir(dir, 'project').warnings).toEqual([]);
  });

  it('reports an unreadable entry as malformed and caps the list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'persona-warnings-'));
    mkdirSync(join(dir, 'dir.json'));
    for (let i = 0; i < PERSONA_WARNING_LIMIT + 20; i += 1) writeFileSync(join(dir, `bad-${i}.json`), '{ nope');
    const { warnings } = readPersonaDir(dir, 'user');
    expect(warnings).toHaveLength(PERSONA_WARNING_LIMIT);
    expect(readPersonaDir(join(dir, '..', 'x'), 'user').warnings).toEqual([]);
  });

  it('A5: lists only the personas the loader keeps, with the raw JSON, and reports the dropped one with its reason', () => {
    const dir = mkdtempSync(join(tmpdir(), 'persona-warnings-'));
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ id: 'a', name: 'A', reasoningLevel: 'from-the-future' }));
    writeFileSync(join(dir, 'no-name.json'), JSON.stringify({ id: 'b', name: '  ' }));
    expect(readPersonaDir(dir, 'user')).toEqual({
      personas: [{ id: 'a', name: 'A', reasoningLevel: 'from-the-future' }],
      warnings: [{ file: 'no-name.json', source: 'user', reason: 'empty-name' }]
    });
  });

  it('reads at most the scan limit of files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'persona-warnings-'));
    for (let i = 0; i < PERSONA_FILE_SCAN_LIMIT + 5; i += 1) writeFileSync(join(dir, `p-${i}.json`), JSON.stringify({ id: `p${i}`, name: 'P' }));
    expect(readPersonaDir(dir, 'user').personas).toHaveLength(PERSONA_FILE_SCAN_LIMIT);
  });
});
