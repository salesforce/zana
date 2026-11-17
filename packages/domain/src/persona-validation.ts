import { VALID_PROFILES } from './launch-provider.js';
import {
  PERSONA_REASONING_LEVELS,
  sanitizePersonaSkills,
  type HarnessFamily,
  type Persona,
  type PersonaHarnessIntentV1,
  type PersonaHarnessRoutingV1
} from './product.js';
import type { PersonaDropReason } from './persona-load-warning.js';

/** The one drop-rule table shared by the server loader and `zcc personas ls`. */
export const VALID_PERSONA_PERMISSION_MODES: ReadonlyArray<NonNullable<Persona['permissionMode']>> = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions'
];

const MODEL_LEVELS = ['low', 'medium', 'high', 'extra-high'];
const EXECUTION_STATES = ['plan', 'interactive', 'accept-edits', 'autonomous'];
const CODEX_SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access'];
const CODEX_APPROVALS = ['untrusted', 'on-request', 'never'];
const HARNESS_FAMILIES: HarnessFamily[] = ['claude', 'cursor', 'codex', 'pi', 'opencode', 'grok', 'mastracode', 'afcode'];

const optionalString = (v: unknown): boolean => v === undefined || typeof v === 'string';

function sanitizeIntentCompatibility(c: unknown): PersonaHarnessIntentV1['compatibility'] | null {
  if (!c || typeof c !== 'object') return null;
  const src = c as Record<string, unknown>;
  const compat: NonNullable<PersonaHarnessIntentV1['compatibility']> = {};
  for (const key of ['model', 'permissionMode', 'codexSandbox', 'codexApproval'] as const) {
    if (!optionalString(src[key])) return null;
    if (src[key] !== undefined) compat[key] = src[key] as never;
  }
  return compat;
}

function sanitizeIntent(value: unknown): PersonaHarnessIntentV1 | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const intent: PersonaHarnessIntentV1 = {};
  for (const key of ['roleTargetId', 'providerTargetId', 'modelTargetId', 'executionTargetId'] as const) {
    if (!optionalString(v[key])) return null;
    if (v[key] !== undefined) intent[key] = v[key] as string;
  }
  if (v.executionState !== undefined) {
    if (!EXECUTION_STATES.includes(v.executionState as string)) return null;
    intent.executionState = v.executionState as PersonaHarnessIntentV1['executionState'];
  }
  if (v.compatibility !== undefined) {
    const compat = sanitizeIntentCompatibility(v.compatibility);
    if (!compat) return null;
    intent.compatibility = compat;
  }
  return intent;
}

export function sanitizeHarnessRouting(routing: unknown): PersonaHarnessRoutingV1 | null {
  if (!routing || typeof routing !== 'object') return null;
  const r = routing as { schemaVersion?: unknown; byAdapter?: unknown };
  if (r.schemaVersion !== 1) return null;
  if (!r.byAdapter || typeof r.byAdapter !== 'object') return null;
  const byAdapter: Partial<Record<HarnessFamily, PersonaHarnessIntentV1>> = {};
  for (const [key, value] of Object.entries(r.byAdapter)) {
    if (!HARNESS_FAMILIES.includes(key as HarnessFamily)) return null;
    const intent = sanitizeIntent(value);
    if (!intent) return null;
    byAdapter[key as HarnessFamily] = intent;
  }
  return { schemaVersion: 1, byAdapter };
}

const blank = (v: unknown): boolean => typeof v !== 'string' || !v.trim();

/** First drop rule a raw persona object breaks, or null when the loader keeps it. */
export function personaDropReason(raw: unknown): PersonaDropReason | null {
  if (!raw || typeof raw !== 'object') return 'not-an-object';
  const r = raw as Record<string, unknown>;
  if (blank(r.id)) return 'empty-id';
  if (blank(r.name)) return 'empty-name';
  if (r.baseProfile && !(VALID_PROFILES as readonly unknown[]).includes(r.baseProfile)) return 'bad-base-profile';
  if (r.model !== undefined && typeof r.model !== 'string') return 'non-string-model';
  if (r.permissionMode && !(VALID_PERSONA_PERMISSION_MODES as readonly unknown[]).includes(r.permissionMode)) return 'bad-permission-mode';
  if (r.codexSandbox && !CODEX_SANDBOXES.includes(r.codexSandbox as string)) return 'bad-codex-sandbox';
  if (r.codexApproval && !CODEX_APPROVALS.includes(r.codexApproval as string)) return 'bad-codex-approval';
  if (r.modelLevel !== undefined && !MODEL_LEVELS.includes(r.modelLevel as string)) return 'bad-model-level';
  if (r.reasoningLevel !== undefined && !(PERSONA_REASONING_LEVELS as readonly unknown[]).includes(r.reasoningLevel)) return 'bad-reasoning-level';
  if (r.executionState !== undefined && !EXECUTION_STATES.includes(r.executionState as string)) return 'bad-execution-state';
  if (r.harnessRouting !== undefined && !sanitizeHarnessRouting(r.harnessRouting)) return 'bad-harness-routing';
  if (sanitizePersonaSkills(r.skills) === null) return 'bad-skills';
  return null;
}

export type PersonaJsonCheck = { raw: unknown; reason: null } | { raw?: undefined; reason: PersonaDropReason };

/**
 * Parse persona file text and apply the drop rules. The reason comes from a
 * fixed table, never from the parser's message, which can echo file content.
 * An unknown `reasoningLevel` (written by a newer Zana) is ignored, not a drop.
 */
export function checkPersonaJson(content: string): PersonaJsonCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { reason: 'malformed-json' };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (obj.reasoningLevel !== undefined && !(PERSONA_REASONING_LEVELS as readonly unknown[]).includes(obj.reasoningLevel)) {
      delete obj.reasoningLevel;
    }
  }
  const reason = personaDropReason(raw);
  return reason ? { reason } : { raw, reason: null };
}
