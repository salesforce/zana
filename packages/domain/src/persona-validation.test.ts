import { describe, it, expect } from 'vitest';
import { personaDropReason, personaFileDropReason, parsePersonaFileContent, sanitizeHarnessRouting, pushPersonaWarning, PERSONA_LOAD_WARNINGS_MAX, PERSONA_DROP_REASONS, PERSONA_DROP_REASON_TEXT, type PersonaLoadWarning } from './persona-validation.js';

describe('persona-validation', () => {
  it('rejects falsy-but-invalid enum values instead of treating them as absent', () => {
    const base = { id: 'a', name: 'A' };
    expect(personaDropReason({ ...base, baseProfile: false })).toBe('invalid_base_profile');
    expect(personaDropReason({ ...base, permissionMode: 0 })).toBe('invalid_permission_mode');
    expect(personaDropReason({ ...base, codexSandbox: false })).toBe('invalid_codex_sandbox');
    expect(personaDropReason({ ...base, codexApproval: 0 })).toBe('invalid_codex_approval');
    expect(personaDropReason(base)).toBeNull();
  });

  it('keeps loading files whose optional enum fields are null or empty (treated as unset)', () => {
    const base = { id: 'a', name: 'A' };
    expect(personaDropReason({ ...base, baseProfile: '' })).toBeNull();
    expect(personaDropReason({ ...base, codexSandbox: null })).toBeNull();
    expect(personaDropReason({ ...base, codexApproval: '', permissionMode: null })).toBeNull();
  });

  it('parsePersonaFileContent parses once and returns the object or a reason', () => {
    expect(parsePersonaFileContent('{ nope')).toEqual({ reason: 'malformed_json', value: null });
    expect(parsePersonaFileContent('[]')).toEqual({ reason: 'not_an_object', value: null });
    expect(parsePersonaFileContent('{"id":"a","name":"A"}')).toEqual({ reason: null, value: { id: 'a', name: 'A' } });
  });

  it('has fixed text for every reason', () => {
    for (const r of PERSONA_DROP_REASONS) expect(PERSONA_DROP_REASON_TEXT[r]).toBeTruthy();
  });
  it('accepts a minimal persona and valid routing', () => {
    expect(personaDropReason({ id: 'a', name: 'A' })).toBeNull();
    expect(personaDropReason({ id: 'a', name: 'A', harnessRouting: { schemaVersion: 1, byAdapter: { claude: { modelTargetId: 'm', executionState: 'plan', compatibility: { model: 'x' } } } } })).toBeNull();
  });
  it('rejects malformed routing shapes', () => {
    for (const bad of [null, { schemaVersion: 1 }, { schemaVersion: 1, byAdapter: { bogus: {} } }, { schemaVersion: 1, byAdapter: { claude: 1 } },
      { schemaVersion: 1, byAdapter: { claude: { roleTargetId: 1 } } }, { schemaVersion: 1, byAdapter: { claude: { executionState: 'x' } } },
      { schemaVersion: 1, byAdapter: { claude: { compatibility: 1 } } }, { schemaVersion: 1, byAdapter: { claude: { compatibility: { model: 1 } } } }]) {
      expect(sanitizeHarnessRouting(bad)).toBeNull();
    }
  });
  it('strictReasoning only applies when asked', () => {
    expect(personaDropReason({ id: 'a', name: 'A', reasoningLevel: 'zzz' })).toBeNull();
    expect(personaDropReason({ id: 'a', name: 'A', reasoningLevel: 'zzz' }, { strictReasoning: true })).toBe('invalid_reasoning_level');
    expect(personaDropReason({ id: 'a', name: 'A', reasoningLevel: 'high' }, { strictReasoning: true })).toBeNull();
  });
  it('classifies files', () => {
    expect(personaFileDropReason('nope')).toBe('malformed_json');
    expect(personaFileDropReason('null')).toBe('not_an_object');
    expect(personaFileDropReason('{"id":"a","name":"A"}')).toBeNull();
  });
  it('caps warnings', () => {
    const list: PersonaLoadWarning[] = [];
    for (let i = 0; i < PERSONA_LOAD_WARNINGS_MAX + 5; i++) pushPersonaWarning(list, { file: `${i}.json`, source: 'user', reason: 'malformed_json' });
    expect(list).toHaveLength(PERSONA_LOAD_WARNINGS_MAX);
  });
});
