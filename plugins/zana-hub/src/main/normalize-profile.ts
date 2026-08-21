/**
 * Pure profile-template normalization for zana-hub's editor — NO filesystem
 * dependency, so it is fully unit-testable. Mirrors `normalize-team.ts`:
 * unknown/unedited keys on the base object are preserved round-trip, and
 * `createdAt` / `builtIn` are retained across a save.
 */
import type { ZanaProfileTemplate } from '../shared/types.js';

/** Returns an error message, or null if the template is valid. */
export function validateProfile(input: ZanaProfileTemplate): string | null {
  if (!input || typeof input.displayName !== 'string' || !input.displayName.trim()) {
    return 'Profile name is required.';
  }
  if (!Array.isArray(input.allowedTools) || !Array.isArray(input.disallowedTools)) {
    return 'Tool lists must be arrays.';
  }
  return null;
}

/** Drop empties + duplicates while preserving first-seen order. */
function cleanTools(tools: string[]): string[] {
  const out: string[] = [];
  for (const raw of tools) {
    const t = typeof raw === 'string' ? raw.trim() : '';
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Read a string field off the base object, or undefined. */
function baseString(base: Record<string, unknown>, key: string): string | undefined {
  const v = base[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Merge `input` onto `base` (the raw parsed existing file, or `{}` for a new
 * profile), and return the object to serialize. Callers pass the resolved `id`
 * and an ISO timestamp (kept as params so this stays pure and deterministic
 * under test). `createdAt` and `builtIn` are preserved from the base; edited
 * fields overwrite; unknown top-level keys survive via the spread.
 */
export function normalizeProfile(
  input: ZanaProfileTemplate,
  base: Record<string, unknown>,
  id: string,
  nowIso: string
): Record<string, unknown> {
  return {
    ...base, // preserve unknown/unedited top-level keys
    id,
    displayName: input.displayName.trim(),
    icon: input.icon,
    description: input.description,
    category: input.category,
    model: input.model,
    effortLevel: input.effortLevel,
    permissionMode: input.permissionMode,
    systemPrompt: input.systemPrompt,
    allowedTools: cleanTools(input.allowedTools),
    disallowedTools: cleanTools(input.disallowedTools),
    builtIn: base.builtIn === true,
    createdAt: baseString(base, 'createdAt') ?? nowIso,
    updatedAt: nowIso
  };
}
