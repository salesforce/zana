import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERSONA_WARNING_LIMIT, personaFileWarnings } from './persona-warnings.js';

describe('personaFileWarnings', () => {
  it('returns nothing for a missing directory', () => {
    expect(personaFileWarnings(join(tmpdir(), 'no-such-personas-dir'), 'user')).toEqual([]);
  });

  it('ignores non-JSON files, keeps valid personas quiet, and tolerates a newer reasoningLevel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'persona-warnings-'));
    writeFileSync(join(dir, 'notes.txt'), 'x');
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ id: 'a', name: 'A', reasoningLevel: 'from-the-future' }));
    expect(personaFileWarnings(dir, 'project')).toEqual([]);
  });

  it('reports an unreadable entry as malformed and caps the list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'persona-warnings-'));
    mkdirSync(join(dir, 'dir.json'));
    for (let i = 0; i < PERSONA_WARNING_LIMIT + 20; i += 1) writeFileSync(join(dir, `bad-${i}.json`), '{ nope');
    const warnings = personaFileWarnings(dir, 'user');
    expect(warnings).toHaveLength(PERSONA_WARNING_LIMIT);
    expect(personaFileWarnings(join(dir, '..', 'x'), 'user')).toEqual([]);
  });
});
