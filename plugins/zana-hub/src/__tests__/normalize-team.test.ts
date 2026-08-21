import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug, validateTeam, normalizeTeam } from '../main/normalize-team.js';
import type { ZanaTeamTemplate } from '../shared/types.js';

const NOW = '2026-07-07T12:00:00.000Z';

function tmpl(over: Partial<ZanaTeamTemplate> = {}): ZanaTeamTemplate {
  return {
    name: 'Backend Squad',
    slots: [
      { profileId: 'architect', quantity: 1 },
      { profileId: 'backend-dev', quantity: 2 }
    ],
    ...over
  };
}

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Backend Squad')).toBe('backend-squad');
  });
  it('strips punctuation and collapses separators', () => {
    expect(slugify('Core Dev / Squad!!')).toBe('core-dev-squad');
  });
  it('falls back to "team" for an empty/degenerate name', () => {
    expect(slugify('   ')).toBe('team');
    expect(slugify('!!!')).toBe('team');
  });
});

describe('uniqueSlug', () => {
  it('returns the plain slug when free', () => {
    expect(uniqueSlug('Backend Squad', ['other'])).toBe('backend-squad');
  });
  it('suffixes -2, -3 on collision', () => {
    expect(uniqueSlug('Backend Squad', ['backend-squad'])).toBe('backend-squad-2');
    expect(uniqueSlug('Backend Squad', ['backend-squad', 'backend-squad-2'])).toBe('backend-squad-3');
  });
});

describe('validateTeam', () => {
  it('accepts a valid template', () => {
    expect(validateTeam(tmpl())).toBeNull();
  });
  it('rejects empty name', () => {
    expect(validateTeam(tmpl({ name: '  ' }))).toMatch(/name/i);
  });
  it('rejects empty slots', () => {
    expect(validateTeam(tmpl({ slots: [] }))).toMatch(/slot/i);
  });
  it('rejects a slot with blank profileId', () => {
    expect(validateTeam(tmpl({ slots: [{ profileId: '', quantity: 1 }] }))).toMatch(/profile/i);
  });
  it('rejects quantity < 1 or non-integer', () => {
    expect(validateTeam(tmpl({ slots: [{ profileId: 'a', quantity: 0 }] }))).toMatch(/quantity/i);
    expect(validateTeam(tmpl({ slots: [{ profileId: 'a', quantity: 1.5 }] }))).toMatch(/quantity/i);
  });
  it('rejects maxConcurrentWorkers < 1 when provided', () => {
    expect(validateTeam(tmpl({ maxConcurrentWorkers: 0 }))).toMatch(/concurrent/i);
  });
});

describe('normalizeTeam', () => {
  it('derives workerProfileIds as distinct first-seen ids', () => {
    const out = normalizeTeam(
      tmpl({ slots: [
        { profileId: 'architect', quantity: 1 },
        { profileId: 'backend-dev', quantity: 2 },
        { profileId: 'architect', quantity: 1 }
      ] }),
      {},
      'backend-squad',
      NOW
    );
    expect(out.workerProfileIds).toEqual(['architect', 'backend-dev']);
  });
  it('derives maxTotalWorkers as the sum of quantities', () => {
    const out = normalizeTeam(tmpl(), {}, 'backend-squad', NOW);
    expect(out.maxTotalWorkers).toBe(3); // 1 + 2
  });
  it('sets rules.maxConcurrentWorkers independently from the input', () => {
    const out = normalizeTeam(tmpl({ maxConcurrentWorkers: 4 }), {}, 'x', NOW);
    expect((out.rules as Record<string, unknown>).maxConcurrentWorkers).toBe(4);
    expect(out.maxTotalWorkers).toBe(3); // unchanged by concurrency
  });
  it('falls back concurrency to existing rules, then to total', () => {
    const withBase = normalizeTeam(tmpl(), { rules: { maxConcurrentWorkers: 9, autoRestart: true } }, 'x', NOW);
    expect((withBase.rules as Record<string, unknown>).maxConcurrentWorkers).toBe(9);
    const noBase = normalizeTeam(tmpl(), {}, 'x', NOW);
    expect((noBase.rules as Record<string, unknown>).maxConcurrentWorkers).toBe(3); // = total
  });
  it('preserves unknown/unedited keys round-trip', () => {
    const base = {
      rules: { maxConcurrentWorkers: 4, autoRestart: true, requireApproval: false },
      dynamicSpawning: true,
      someFutureKey: 'keep-me'
    };
    const out = normalizeTeam(tmpl(), base, 'backend-squad', NOW);
    expect((out.rules as Record<string, unknown>).autoRestart).toBe(true);
    expect((out.rules as Record<string, unknown>).requireApproval).toBe(false);
    expect(out.dynamicSpawning).toBe(true);
    expect(out.someFutureKey).toBe('keep-me');
  });
  it('stamps id and updatedAt', () => {
    const out = normalizeTeam(tmpl(), {}, 'backend-squad', NOW);
    expect(out.id).toBe('backend-squad');
    expect(out.updatedAt).toBe(NOW);
  });
  it('writes the editable scalar fields', () => {
    const out = normalizeTeam(
      tmpl({ icon: '⚙️', description: 'desc', orchestratorProfileId: 'orchestrator', initialPrompt: 'go', autoStart: true }),
      {},
      'x',
      NOW
    );
    expect(out.name).toBe('Backend Squad');
    expect(out.icon).toBe('⚙️');
    expect(out.description).toBe('desc');
    expect(out.orchestratorProfileId).toBe('orchestrator');
    expect(out.initialPrompt).toBe('go');
    expect(out.autoStart).toBe(true);
  });
});
