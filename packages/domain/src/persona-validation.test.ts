import { describe, it, expect } from 'vitest';
import { personaDropReason, personaFileDropReason, sanitizeHarnessRouting, pushPersonaWarning, PERSONA_LOAD_WARNINGS_MAX, PERSONA_DROP_REASONS, PERSONA_DROP_REASON_TEXT, type PersonaLoadWarning } from './persona-validation.js';

describe('persona-validation', () => {
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
