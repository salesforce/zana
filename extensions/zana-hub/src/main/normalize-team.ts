/**
 * Pure team-template normalization for zana-hub's editor — NO filesystem
 * dependency, so it is fully unit-testable. `slots` is the source of truth;
 * `workerProfileIds` and `maxTotalWorkers` are DERIVED on every write, and
 * unknown/unedited keys on the base object are preserved round-trip.
 */
import type { ZanaTeamTemplate } from '../shared/types.js';

/** Lowercase, non-alphanumerics → single '-', trimmed; empty → 'team'. */
export function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'team';
}

/** `slugify`, then suffix -2, -3, … until it is not in `existingStems`. */
export function uniqueSlug(name: string, existingStems: string[]): string {
  const taken = new Set(existingStems);
  const base = slugify(name);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Returns an error message, or null if the template is valid. */
export function validateTeam(input: ZanaTeamTemplate): string | null {
  if (!input || typeof input.name !== 'string' || !input.name.trim()) {
    return 'Team name is required.';
  }
  if (!Array.isArray(input.slots) || input.slots.length === 0) {
    return 'At least one roster slot is required.';
  }
  for (const s of input.slots) {
    if (!s || typeof s.profileId !== 'string' || !s.profileId.trim()) {
      return 'Every slot needs a profile.';
    }
    if (typeof s.quantity !== 'number' || !Number.isInteger(s.quantity) || s.quantity < 1) {
      return 'Slot quantity must be a whole number ≥ 1.';
    }
  }
  if (
    input.maxConcurrentWorkers != null &&
    (!Number.isInteger(input.maxConcurrentWorkers) || input.maxConcurrentWorkers < 1)
  ) {
    return 'Max concurrent workers must be a whole number ≥ 1.';
  }
  return null;
}

/**
 * Merge `input` onto `base` (the raw parsed existing file, or `{}` for a new
 * team), set all derived fields, and return the object to serialize. Callers
 * pass the resolved `id` and an ISO timestamp (kept as params so this stays
 * pure and deterministic under test).
 */
export function normalizeTeam(
  input: ZanaTeamTemplate,
  base: Record<string, unknown>,
  id: string,
  nowIso: string
): Record<string, unknown> {
  const slots = input.slots.map((s) => ({ profileId: s.profileId, quantity: s.quantity }));

  // Distinct profileIds, first-seen order.
  const workerProfileIds: string[] = [];
  for (const s of slots) if (!workerProfileIds.includes(s.profileId)) workerProfileIds.push(s.profileId);

  const maxTotalWorkers = slots.reduce((n, s) => n + s.quantity, 0);

  const baseRules = (base.rules && typeof base.rules === 'object' ? base.rules : {}) as Record<string, unknown>;
  const existingConcurrency =
    typeof baseRules.maxConcurrentWorkers === 'number' ? baseRules.maxConcurrentWorkers : undefined;
  const maxConcurrentWorkers = input.maxConcurrentWorkers ?? existingConcurrency ?? maxTotalWorkers;

  return {
    ...base, // preserve unknown/unedited top-level keys (dynamicSpawning, …)
    id,
    name: input.name.trim(),
    icon: input.icon,
    description: input.description,
    orchestratorProfileId: input.orchestratorProfileId,
    slots,
    initialPrompt: input.initialPrompt,
    rules: { ...baseRules, maxConcurrentWorkers },
    autoStart: input.autoStart === true,
    workerProfileIds,
    maxTotalWorkers,
    updatedAt: nowIso
  };
}
