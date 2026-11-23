/**
 * Persona file validation shared by the app's PersonaStore, the loopback
 * product API and the `zcc` CLI, so every reader drops exactly the same files
 * and reports the same fixed reason. Pure: no filesystem or Electron access.
 */
import type { Persona, PersonaHarnessIntentV1, PersonaHarnessRoutingV1, HarnessFamily } from './product.js';
import { PERSONA_REASONING_LEVELS, sanitizePersonaSkills } from './product.js';
import { VALID_PROFILES } from './launch-provider.js';

export const PERSONA_DROP_REASONS = [
  'unreadable_file',
  'malformed_json',
  'not_an_object',
  'missing_id',
  'missing_name',
  'invalid_base_profile',
  'invalid_model',
  'invalid_permission_mode',
  'invalid_codex_sandbox',
  'invalid_codex_approval',
  'invalid_model_level',
  'invalid_reasoning_level',
  'invalid_execution_state',
  'invalid_harness_routing',
  'invalid_skills',
  'invalid_persona'
] as const;

export type PersonaDropReason = (typeof PERSONA_DROP_REASONS)[number];

/**
 * Fixed, user-facing text per reason. Deliberately never derived from file
 * content or from a parser error message (those can echo input excerpts).
 */
export const PERSONA_DROP_REASON_TEXT: Readonly<Record<PersonaDropReason, string>> = {
  unreadable_file: 'File could not be read',
  malformed_json: 'Not valid JSON',
  not_an_object: 'Top level must be a JSON object',
  missing_id: 'Missing or empty "id"',
  missing_name: 'Missing or empty "name"',
  invalid_base_profile: 'Unknown "baseProfile"',
  invalid_model: '"model" must be a string',
  invalid_permission_mode: 'Unknown "permissionMode"',
  invalid_codex_sandbox: 'Unknown "codexSandbox"',
  invalid_codex_approval: 'Unknown "codexApproval"',
  invalid_model_level: 'Unknown "modelLevel"',
  invalid_reasoning_level: 'Unknown "reasoningLevel"',
  invalid_execution_state: 'Unknown "executionState"',
  invalid_harness_routing: 'Invalid "harnessRouting"',
  invalid_skills: 'Invalid "skills"',
  invalid_persona: 'Persona could not be normalized'
};

/** A persona file the loader ignored. `file` is a basename only. */
export interface PersonaLoadWarning {
  file: string;
  source: 'user' | 'project';
  reason: PersonaDropReason;
}

export const PERSONA_LOAD_WARNINGS_MAX = 100;

const VALID_PERMISSION_MODES: readonly string[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
const VALID_MODEL_LEVELS: readonly string[] = ['low', 'medium', 'high', 'extra-high'];
const VALID_EXECUTION_STATES: readonly string[] = ['plan', 'interactive', 'accept-edits', 'autonomous'];
const VALID_HARNESS_FAMILIES: readonly string[] = ['claude', 'cursor', 'codex', 'pi', 'opencode', 'grok', 'mastracode', 'afcode'];

/** Validate and normalize persona `harnessRouting`; null when malformed. */
export function sanitizeHarnessRouting(routing: unknown): PersonaHarnessRoutingV1 | null {
  if (!routing || typeof routing !== 'object') return null;
  const r = routing as any;
  if (r.schemaVersion !== 1) return null;
  if (!r.byAdapter || typeof r.byAdapter !== 'object') return null;

  const byAdapter: Partial<Record<HarnessFamily, PersonaHarnessIntentV1>> = {};
  for (const [key, value] of Object.entries(r.byAdapter)) {
    if (!VALID_HARNESS_FAMILIES.includes(key)) return null;
    if (!value || typeof value !== 'object') return null;
    const v = value as any;

    const intent: PersonaHarnessIntentV1 = {};
    for (const field of ['roleTargetId', 'providerTargetId', 'modelTargetId', 'executionTargetId'] as const) {
      if (v[field] !== undefined) {
        if (typeof v[field] !== 'string') return null;
        intent[field] = v[field];
      }
    }
    if (v.executionState !== undefined) {
      if (!VALID_EXECUTION_STATES.includes(v.executionState)) return null;
      intent.executionState = v.executionState;
    }
    if (v.compatibility !== undefined) {
      if (!v.compatibility || typeof v.compatibility !== 'object') return null;
      const c = v.compatibility;
      const compat: NonNullable<PersonaHarnessIntentV1['compatibility']> = {};
      for (const field of ['model', 'permissionMode', 'codexSandbox', 'codexApproval'] as const) {
        if (c[field] !== undefined) {
          if (typeof c[field] !== 'string') return null;
          compat[field] = c[field];
        }
      }
      intent.compatibility = compat;
    }
    byAdapter[key as HarnessFamily] = intent;
  }
  return { schemaVersion: 1, byAdapter };
}

/**
 * Why a parsed persona object would be dropped, or null when it is accepted.
 * The single rule set behind `sanitizePersona`. An unrecognized
 * `reasoningLevel` is NOT a drop for a file load (forward compatibility); pass
 * `strictReasoning` for the form write path.
 */
export function personaDropReason(raw: unknown, opts: { strictReasoning?: boolean } = {}): PersonaDropReason | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'not_an_object';
  const r = raw as Partial<Persona>;
  if (typeof r.id !== 'string' || !r.id.trim()) return 'missing_id';
  if (typeof r.name !== 'string' || !r.name.trim()) return 'missing_name';
  if (isSet(r.baseProfile) && !(VALID_PROFILES as readonly string[]).includes(r.baseProfile)) return 'invalid_base_profile';
  if (r.model !== undefined && typeof r.model !== 'string') return 'invalid_model';
  if (isSet(r.permissionMode) && !VALID_PERMISSION_MODES.includes(r.permissionMode)) return 'invalid_permission_mode';
  if (isSet(r.codexSandbox) && !['read-only', 'workspace-write', 'danger-full-access'].includes(r.codexSandbox)) return 'invalid_codex_sandbox';
  if (isSet(r.codexApproval) && !['untrusted', 'on-request', 'never'].includes(r.codexApproval)) return 'invalid_codex_approval';
  if (r.modelLevel !== undefined && (typeof r.modelLevel !== 'string' || !VALID_MODEL_LEVELS.includes(r.modelLevel))) return 'invalid_model_level';
  if (opts.strictReasoning && r.reasoningLevel !== undefined
    && (typeof r.reasoningLevel !== 'string' || !(PERSONA_REASONING_LEVELS as readonly string[]).includes(r.reasoningLevel))) {
    return 'invalid_reasoning_level';
  }
  if (r.executionState !== undefined && (typeof r.executionState !== 'string' || !VALID_EXECUTION_STATES.includes(r.executionState))) return 'invalid_execution_state';
  if (r.harnessRouting !== undefined && !sanitizeHarnessRouting(r.harnessRouting)) return 'invalid_harness_routing';
  if (sanitizePersonaSkills(r.skills) === null) return 'invalid_skills';
  return null;
}

/**
 * Optional enum fields: `null` and `""` have always loaded as "unset", so existing files keep
 * loading. Any other present value (including `false` or `0`) must be a valid option.
 */
function isSet<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Parse a raw persona file once: the parsed object when accepted, otherwise the
 * fixed drop reason. Never throws.
 */
export function parsePersonaFileContent(content: string):
  | { reason: null; value: Record<string, unknown> }
  | { reason: PersonaDropReason; value: null } {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { reason: 'malformed_json', value: null };
  }
  const reason = personaDropReason(raw);
  return reason ? { reason, value: null } : { reason: null, value: raw as Record<string, unknown> };
}

/** Reason for a raw persona file's text, or null when it loads. Never throws. */
export function personaFileDropReason(content: string): PersonaDropReason | null {
  return parsePersonaFileContent(content).reason;
}

/** Append a warning, enforcing the list cap. */
export function pushPersonaWarning(list: PersonaLoadWarning[], warning: PersonaLoadWarning): void {
  if (list.length < PERSONA_LOAD_WARNINGS_MAX) list.push(warning);
}
