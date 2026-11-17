/** Why a persona file was dropped by the loader (one value per drop rule in `sanitizePersona` / the file parser). */
export type PersonaDropReason =
  | 'malformed-json'
  | 'not-an-object'
  | 'empty-id'
  | 'empty-name'
  | 'bad-base-profile'
  | 'non-string-model'
  | 'bad-permission-mode'
  | 'bad-codex-sandbox'
  | 'bad-codex-approval'
  | 'bad-model-level'
  | 'bad-reasoning-level'
  | 'bad-execution-state'
  | 'bad-harness-routing'
  | 'bad-skills';

/** A persona file the loader dropped, so a launch can say which personas are missing and why. */
export type PersonaLoadWarning = {
  file: string;
  source: 'user' | 'project';
  reason: PersonaDropReason;
};
