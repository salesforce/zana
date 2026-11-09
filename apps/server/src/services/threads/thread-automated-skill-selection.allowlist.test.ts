import { beforeEach, describe, expect, it, vi } from 'vitest';

const meta = vi.hoisted(() => ({ value: { metadata: {} as Record<string, unknown>, corrupt: false } }));
vi.mock('@zana-ai/zcc-db', async (orig) => ({
  ...(await orig<typeof import('@zana-ai/zcc-db')>()),
  getThreadPluginMetadata: () => meta.value,
  patchThreadPluginMetadata: (...args: unknown[]) => { patch.calls.push(args[1]); return patch.result; }
}));
const patch = vi.hoisted(() => ({ calls: [] as unknown[], result: { ok: true } as { ok: boolean } }));

import { copyThreadAutomatedSkillIds, threadAllowedSkillNames, threadSkillSelection } from './thread-automated-skill-selection.js';

const db = {} as never;
const set = (metadata: Record<string, unknown>, corrupt = false) => { meta.value = { metadata, corrupt }; };
beforeEach(() => { set({}); patch.calls = []; patch.result = { ok: true }; });

describe('threadAllowedSkillNames', () => {
  it('is undefined when the key is absent (unrestricted)', () => {
    expect(threadAllowedSkillNames(db, 't')).toBeUndefined();
  });
  it('returns a list, preserving an empty array', () => {
    set({ allowedSkillNames: ['a'] });
    expect(threadAllowedSkillNames(db, 't')).toEqual(['a']);
    set({ allowedSkillNames: [] });
    expect(threadAllowedSkillNames(db, 't')).toEqual([]);
  });
  it('throws on corrupt or invalid metadata', () => {
    set({}, true);
    expect(() => threadAllowedSkillNames(db, 't')).toThrow(/corrupt/);
    for (const bad of ['x', [1], [''], ['a'.repeat(257)], Array.from({ length: 65 }, (_, i) => `s${i}`)]) {
      set({ allowedSkillNames: bad });
      expect(() => threadAllowedSkillNames(db, 't')).toThrow(/invalid/);
    }
  });
});

describe('threadSkillSelection', () => {
  it('omits absent fields', () => {
    expect(threadSkillSelection(db, 't')).toEqual({});
  });
  it('returns both fields when present', () => {
    set({ automatedSkillIds: ['zcc:a/b'], allowedSkillNames: [] });
    expect(threadSkillSelection(db, 't')).toEqual({ automatedSkillIds: ['zcc:a/b'], allowedSkillNames: [] });
  });
});

describe('copyThreadAutomatedSkillIds (fork)', () => {
  it('copies nothing for an unrestricted source', () => {
    copyThreadAutomatedSkillIds(db, 's', 't');
    expect(patch.calls).toEqual([]);
  });
  it('copies both fields, so a forked restricted thread stays restricted', () => {
    set({ automatedSkillIds: ['zcc:a/b'], allowedSkillNames: [] });
    copyThreadAutomatedSkillIds(db, 's', 't');
    expect(patch.calls[0]).toMatchObject({ threadId: 't', set: { automatedSkillIds: ['zcc:a/b'], allowedSkillNames: [] } });
  });
  it('copies allowedSkillNames alone', () => {
    set({ allowedSkillNames: ['x'] });
    copyThreadAutomatedSkillIds(db, 's', 't');
    expect(patch.calls[0]).toMatchObject({ set: { allowedSkillNames: ['x'] } });
  });
  it('throws when the target rejects the metadata', () => {
    set({ allowedSkillNames: ['x'] });
    patch.result = { ok: false };
    expect(() => copyThreadAutomatedSkillIds(db, 's', 't')).toThrow(/exceeds limit/);
  });
});
