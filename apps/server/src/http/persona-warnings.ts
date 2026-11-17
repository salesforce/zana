import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPersonaJson, type PersonaLoadWarning } from '@zana-ai/zcc-domain';

/** Most warnings one response lists (same cap as `PersonaStore.loadWarnings`). */
export const PERSONA_WARNING_LIMIT = 100;

/**
 * Persona files in `dir` the loader would drop, by basename and fixed reason.
 * The Electron-bound PersonaStore is not importable in the runtime child, so
 * this runs the same shared drop rules over the files.
 */
export function personaFileWarnings(dir: string, source: PersonaLoadWarning['source']): PersonaLoadWarning[] {
  if (!existsSync(dir)) return [];
  const out: PersonaLoadWarning[] = [];
  for (const file of readdirSync(dir)) {
    if (out.length >= PERSONA_WARNING_LIMIT) break;
    if (!file.endsWith('.json')) continue;
    try {
      const { reason } = checkPersonaJson(readFileSync(join(dir, file), 'utf8'));
      if (reason) out.push({ file, source, reason });
    } catch {
      out.push({ file, source, reason: 'malformed-json' });
    }
  }
  return out;
}
