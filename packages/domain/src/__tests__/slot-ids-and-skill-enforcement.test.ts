import { describe, expect, it } from 'vitest';
import { enforcedSkillAllowlist, isOrchestratorSlotId, ORCHESTRATOR_SLOT_PREFIX } from '../product.js';

describe('isOrchestratorSlotId', () => {
  it('matches the prefixed and bare orchestrator ids only', () => {
    expect(ORCHESTRATOR_SLOT_PREFIX).toBe('orchestrator:');
    expect(isOrchestratorSlotId('orchestrator:lead')).toBe(true);
    expect(isOrchestratorSlotId('orchestrator')).toBe(true);
    expect(isOrchestratorSlotId('engineer:0')).toBe(false);
    expect(isOrchestratorSlotId('my-orchestrator:1')).toBe(false);
  });
});

describe('enforcedSkillAllowlist', () => {
  it('keeps the allowlist for enforcing harnesses and legacy (unknown-provider) snapshots', () => {
    for (const provider of ['claude', 'claude-yolo', 'claude-code', undefined]) {
      expect(enforcedSkillAllowlist({ provider, skillAllowlist: ['a'] })).toEqual(['a']);
    }
  });
  it('treats every other harness as unrestricted', () => {
    for (const provider of ['codex', 'acp-opencode', 'acp-cursor', 'pi', 'acp-grok', 'acp-mastracode', 'acp-afcode']) {
      expect(enforcedSkillAllowlist({ provider, skillAllowlist: ['a'] })).toBeUndefined();
    }
  });
  it('is undefined with no slot or no allowlist', () => {
    expect(enforcedSkillAllowlist(undefined)).toBeUndefined();
    expect(enforcedSkillAllowlist({ provider: 'claude' })).toBeUndefined();
    expect(enforcedSkillAllowlist({ provider: 'claude', skillAllowlist: [] })).toEqual([]);
  });
});
