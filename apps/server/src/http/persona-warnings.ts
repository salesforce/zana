import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPersonaJson, type PersonaLoadWarning } from '@zana-ai/zcc-domain';

/** Most warnings one response lists (same cap as `PersonaStore.loadWarnings`). */
export const PERSONA_WARNING_LIMIT = 100;

/** Most persona files one request reads; a larger directory is listed from its first files only. */
export const PERSONA_FILE_SCAN_LIMIT = 1_000;

/**
 * One pass over a persona directory: the files the loader keeps (raw JSON, as before) and, by basename
 * and fixed reason, the ones it drops. The Electron-bound PersonaStore is not importable in the runtime
 * child, so this runs the same shared drop rules; a dropped file is therefore never listed as a persona.
 */
export function readPersonaDir(dir: string, source: PersonaLoadWarning['source']): { personas: unknown[]; warnings: PersonaLoadWarning[] } {
  const personas: unknown[] = [];
  const warnings: PersonaLoadWarning[] = [];
  if (!existsSync(dir)) return { personas, warnings };
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json')).slice(0, PERSONA_FILE_SCAN_LIMIT)) {
    try {
      const content = readFileSync(join(dir, file), 'utf8');
      const { reason } = checkPersonaJson(content);
      if (!reason) personas.push(JSON.parse(content) as unknown);
      else if (warnings.length < PERSONA_WARNING_LIMIT) warnings.push({ file, source, reason });
    } catch {
      if (warnings.length < PERSONA_WARNING_LIMIT) warnings.push({ file, source, reason: 'malformed-json' });
    }
  }
  return { personas, warnings };
}
