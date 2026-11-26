import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Project } from '@zana-ai/zcc-domain/product';
import { personaFileDropReason, PERSONA_DROP_REASON_TEXT } from '@zana-ai/zcc-domain/persona-validation';
import { readPersonas } from './store-readers.js';

describe('readPersonas uses the shared validator', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cli-personas-')); mkdirSync(join(dir, 'data', 'personas'), { recursive: true }); mkdirSync(join(dir, 'proj', '.zcc', 'personas'), { recursive: true }); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const fixtures: Record<string, string> = {
    'ok.json': JSON.stringify({ id: 'ok', name: 'Ok' }),
    'bad-profile.json': JSON.stringify({ id: 'b', name: 'B', baseProfile: 'nope' }),
    'bad-model.json': JSON.stringify({ id: 'c', name: 'C', model: 3 }),
    'empty-id.json': JSON.stringify({ id: '', name: 'D' }),
    'bad-skills.json': JSON.stringify({ id: 'e', name: 'E', skills: 'x' }),
    'broken.json': '{"id":"f","name":"F", SECRET-BODY'
  };

  it('drops the same files as the server rules, with fixed reason text only', () => {
    for (const [name, body] of Object.entries(fixtures)) {
      writeFileSync(join(dir, 'data', 'personas', name), body);
      writeFileSync(join(dir, 'proj', '.zcc', 'personas', name), body);
    }
    const project = { id: 'p', name: 'Proj', path: join(dir, 'proj') } as Project;
    const { data, warnings } = readPersonas(join(dir, 'data'), [project]);
    expect(data.map((p) => p.id).sort()).toEqual(['ok', 'ok']);
    const expectedDropped = Object.entries(fixtures).filter(([, body]) => personaFileDropReason(body)).length;
    expect(warnings).toHaveLength(expectedDropped * 2);
    expect(warnings).toContain(`personas/broken.json: ${PERSONA_DROP_REASON_TEXT.malformed_json}, skipped`);
    expect(warnings).toContain(`Proj/personas/bad-profile.json: ${PERSONA_DROP_REASON_TEXT.invalid_base_profile}, skipped`);
    expect(warnings.join('\n')).not.toContain('SECRET-BODY');
  });

  it('reports unreadable entries with fixed text', () => {
    mkdirSync(join(dir, 'data', 'personas', 'dir.json'));
    const { warnings } = readPersonas(join(dir, 'data'), []);
    expect(warnings).toEqual([`personas/dir.json: ${PERSONA_DROP_REASON_TEXT.unreadable_file}, skipped`]);
  });
});
