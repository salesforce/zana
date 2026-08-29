import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function listJsonFiles(dir: string): unknown[] {
  if (!existsSync(dir)) return [];
  const out: unknown[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown);
    } catch {
      /* skip unreadable records */
    }
  }
  return out;
}

export function readJsonFile(dir: string, id: string): Record<string, unknown> | null {
  const file = join(dir, `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function writeJsonFile(dir: string, id: string, value: unknown): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.json`);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}
