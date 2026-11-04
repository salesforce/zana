import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CITY_FILES, syncAgentCity } from './sync-agent-city.mjs';

const dirs: string[] = [];
async function temporary() { const dir = await mkdtemp(join(tmpdir(), 'city-snapshot-')); dirs.push(dir); return dir; }
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe('website Agent City artwork snapshot', () => {
  it('matches plugin sources and strips all runtime SDK dependencies', async () => {
    const out = await temporary();
    expect(await syncAgentCity(resolve('plugins/agent-city'), out)).toBe('synced');
    for (const file of [...CITY_FILES.map((file: string) => file.replace(/\.ts$/, '.js')), 'palette.css']) {
      const content = await readFile(join(out, file), 'utf8');
      expect(content).toBe(await readFile(resolve('website/lib/agent-city', file), 'utf8'));
      expect(content).not.toContain('@zana-ai/zcc-plugin-sdk');
      expect(content).not.toMatch(/[ \t]+$/m);
    }
  });
  it('keeps the committed artwork in website-only builds and fails if neither source exists', async () => {
    const out = await temporary();
    const missing = join(out, 'missing');
    await expect(syncAgentCity(missing, out)).rejects.toThrow('both missing');
    await writeFile(join(out, 'scene.js'), 'snapshot');
    expect(await syncAgentCity(missing, out)).toBe('snapshot');
    expect(await readFile(join(out, 'scene.js'), 'utf8')).toBe('snapshot');
  });
  it('rejects an upstream palette change instead of silently shipping broken artwork', async () => {
    const source = await temporary(); const out = await temporary();
    await mkdir(source, { recursive: true });
    for (const file of CITY_FILES) await writeFile(join(source, file), 'export const placeholder = 1;');
    await writeFile(join(source, 'styles.ts'), 'No palette');
    await expect(syncAgentCity(source, out)).rejects.toThrow('palette was not found');
  });
});
