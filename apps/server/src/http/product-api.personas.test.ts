import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERSONA_LOAD_WARNINGS_MAX } from '@zana-ai/zcc-domain/persona-validation';
import { readPersonaDiagnostics } from './product-api.js';
import { startProductServer } from './product-server.js';

describe('GET /api/v1/personas', () => {
  it('returns only personas the shared validator accepts, with fixed-reason warnings', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'personas-route-'));
    mkdirSync(join(dataDir, 'personas'));
    writeFileSync(join(dataDir, 'personas', 'ok.json'), JSON.stringify({ id: 'ok', name: 'Ok' }));
    writeFileSync(join(dataDir, 'personas', 'bad.json'), JSON.stringify({ id: 'b', name: 'B', baseProfile: 'nope', appendSystemPrompt: 'TOP-SECRET' }));
    writeFileSync(join(dataDir, 'personas', 'broken.json'), '{ TOP-SECRET');
    const server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 } });
    try {
      const response = await fetch(`${server.url}api/v1/personas`);
      expect(response.status).toBe(200);
      const body = await response.json() as { personas: Array<{ id: string }>; warnings: unknown[] };
      expect(body.personas.map((p) => p.id)).toEqual(['ok']);
      expect(body.warnings).toEqual(expect.arrayContaining([
        { file: 'bad.json', source: 'user', reason: 'invalid_base_profile' },
        { file: 'broken.json', source: 'user', reason: 'malformed_json' }
      ]));
      expect(JSON.stringify(body.warnings)).not.toContain('TOP-SECRET');
    } finally {
      await server.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('readPersonaDiagnostics', () => {
  it('covers project dirs, missing dirs, unreadable entries and the cap', async () => {
    const root = mkdtempSync(join(tmpdir(), 'persona-diag-'));
    try {
      const data = join(root, 'data');
      const proj = join(root, 'proj');
      mkdirSync(join(proj, '.zcc', 'personas'), { recursive: true });
      mkdirSync(join(proj, '.zcc', 'personas', 'dir.json'));
      for (let i = 0; i < PERSONA_LOAD_WARNINGS_MAX + 10; i++) writeFileSync(join(proj, '.zcc', 'personas', `b${i}.json`), '[]');
      writeFileSync(join(proj, '.zcc', 'personas', 'note.txt'), 'ignored');
      const none = await readPersonaDiagnostics(data, [join(root, 'missing')]);
      expect(none).toEqual({ personas: [], warnings: [] });
      const result = await readPersonaDiagnostics(data, [proj]);
      expect(result.personas).toEqual([]);
      expect(result.warnings).toHaveLength(PERSONA_LOAD_WARNINGS_MAX);
      expect(result.warnings.every((w) => w.source === 'project')).toBe(true);
      const small = mkdtempSync(join(root, 's-'));
      mkdirSync(join(small, '.zcc', 'personas', 'dir.json'), { recursive: true });
      expect((await readPersonaDiagnostics(data, [small])).warnings).toEqual([{ file: 'dir.json', source: 'project', reason: 'unreadable_file' }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
