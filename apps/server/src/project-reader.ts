import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Read-only project snapshot owned by the server runtime. Project mutation stays
 * on the compatibility path until its confinement rules migrate with it.
 */
export async function readProjectSnapshot(dataDir: string): Promise<unknown[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(dataDir, 'projects.json'), 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object' && Array.isArray((raw as { projects?: unknown }).projects)) {
      return (raw as { projects: unknown[] }).projects;
    }
  } catch {
    // An absent/corrupt file has always been treated as an empty project list.
  }
  return [];
}
