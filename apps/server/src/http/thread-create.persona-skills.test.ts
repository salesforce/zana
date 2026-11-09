import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const patch = vi.hoisted(() => ({ calls: [] as unknown[], ok: true, events: [] as unknown[], appendThrows: false }));
vi.mock('@zana-ai/zcc-db', async (orig) => ({
  ...(await orig<typeof import('@zana-ai/zcc-db')>()),
  appendConversationThreadEvent: (_db: unknown, input: { threadId: string; type: string; payload: unknown }) => {
    if (patch.appendThrows) throw new Error('db down');
    patch.events.push(input);
    return { threadId: input.threadId, sequence: 7, type: input.type, payload: input.payload };
  },
  patchThreadPluginMetadata: (_db: unknown, input: unknown) => { patch.calls.push(input); return { ok: patch.ok }; }
}));
vi.mock('../services/skills/injected-skill-entries.js', () => ({
  listInjectedSkillEntries: () => [{ id: 'zcc:acme/review', name: 'review' }, { id: 'zcc:acme/zcc-inbox', name: 'zcc-inbox' }]
}));

import { emitPersonaSkillNotice, personaSkillAllowlistNotice, personaThreadSkillFields, persistThreadSkillSelection } from './thread-create.js';

const dataDir = mkdtempSync(join(tmpdir(), 'zcc-persona-skills-'));
mkdirSync(join(dataDir, 'personas'));
const write = (id: string, extra: object) =>
  writeFileSync(join(dataDir, 'personas', `${id}.json`), JSON.stringify({ id, name: id, baseProfile: 'claude', ...extra }));
write('open', {});
write('some', { skills: ['review', 'ext:fmt'] });
write('none', { skills: [] });
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const ctx = { dataDir } as never;

describe('personaThreadSkillFields', () => {
  it('is empty without a persona id, for an unknown persona, and for an unrestricted persona', () => {
    expect(personaThreadSkillFields(ctx)).toEqual({});
    expect(personaThreadSkillFields(ctx, 'missing')).toEqual({});
    expect(personaThreadSkillFields(ctx, 'open')).toEqual({});
  });

  it('resolves a restricted persona to catalog ids, names, and the SDK list', () => {
    const out = personaThreadSkillFields(ctx, 'some');
    expect(out.automatedSkillIds).toEqual(expect.arrayContaining(['zcc:acme/review', 'zcc:acme/zcc-inbox']));
    expect(out.allowedSkillNames).toContain('ext:fmt');
    expect(out.providerOptions?.skillAllowlist).toEqual(expect.arrayContaining(['review', 'ext:fmt', 'zcc-inbox']));
  });

  it('keeps an empty persona list restricted, not unset', () => {
    const out = personaThreadSkillFields(ctx, 'none');
    expect(out.automatedSkillIds).toEqual(['zcc:acme/zcc-inbox']);
    expect(out.providerOptions?.skillAllowlist).toEqual(['zcc-inbox']);
  });

  it('thread.start spreads the main-resolved fields and never reads skill lists from the request input', () => {
    const source = readFileSync(new URL('./thread-create.ts', import.meta.url), 'utf8');
    expect(source).toContain('personaThreadSkillFields(ctx, args.input.personaId, args.project)');
    expect(source).toContain('...skillFields,');
    expect(source).not.toMatch(/args\.input\.(allowedSkillNames|automatedSkillIds|skillAllowlist)/);
  });
});

describe('personaThreadSkillFields persona resolution and persistence', () => {
  it('resolves built-in personas (builtin:reviewer is restricted to the always-allowed skill)', () => {
    const out = personaThreadSkillFields(ctx, 'builtin:reviewer');
    expect(out.automatedSkillIds).toEqual(['zcc:acme/zcc-inbox']);
    expect(out.providerOptions?.skillAllowlist).toEqual(['zcc-inbox']);
  });

  it('resolves project personas, and a malformed skills value is skipped instead of spread into characters', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'zcc-persona-proj-'));
    mkdirSync(join(projectPath, '.zcc', 'personas'), { recursive: true });
    writeFileSync(join(projectPath, '.zcc', 'personas', 'p.json'), JSON.stringify({ id: 'proj', name: 'proj', baseProfile: 'claude', skills: ['review'] }));
    writeFileSync(join(projectPath, '.zcc', 'personas', 'bad.json'), JSON.stringify({ id: 'bad', name: 'bad', baseProfile: 'claude', skills: 'review' }));
    try {
      expect(personaThreadSkillFields(ctx, 'proj', { path: projectPath, remote: undefined } as never).automatedSkillIds)
        .toContain('zcc:acme/review');
      expect(personaThreadSkillFields(ctx, 'proj', { path: projectPath, remote: { hostId: 'h' } } as never)).toEqual({});
      expect(personaThreadSkillFields(ctx, 'bad', { path: projectPath } as never)).toEqual({});
    } finally { rmSync(projectPath, { recursive: true, force: true }); }
  });

  it('persists the selection with the thread and surfaces a limit failure', () => {
    const c = { db: {} } as never;
    persistThreadSkillSelection(c, 't1', {});
    expect(patch.calls).toEqual([]);
    persistThreadSkillSelection(c, 't1', { automatedSkillIds: ['zcc:acme/review'], allowedSkillNames: [] });
    expect(patch.calls[0]).toMatchObject({ threadId: 't1', set: { automatedSkillIds: ['zcc:acme/review'], allowedSkillNames: [] } });
    patch.ok = false;
    expect(() => persistThreadSkillSelection(c, 't1', { allowedSkillNames: ['x'] })).toThrow(/metadata limit/);
    patch.ok = true;
    const source = readFileSync(new URL('./thread-create.ts', import.meta.url), 'utf8');
    expect(source).toContain('persistThreadSkillSelection(ctx, args.thread.id, skillFields)');
  });
});

describe('persona skill allowlist notice (fail loudly, non-fatal)', () => {
  const remote = { path: '/nowhere', remote: { hostId: 'h' } } as never;
  const local = { path: '/nowhere' } as never;

  it('ext: persona launches unrestricted but warns, on local and remote projects', () => {
    expect(personaThreadSkillFields(ctx, 'ext:acme/p', local)).toEqual({});
    expect(personaSkillAllowlistNotice(ctx, 'ext:acme/p', local)).toMatch(/ext:acme\/p.*could not be applied/);
    expect(personaSkillAllowlistNotice(ctx, 'ext:acme/p')).toBeDefined();
    expect(personaSkillAllowlistNotice(ctx, 'ext:acme/p', remote)).toBeDefined();
  });

  it('remote project + unknown persona warns; builtin and user personas resolve without warning', () => {
    expect(personaThreadSkillFields(ctx, 'mystery', remote)).toEqual({});
    expect(personaSkillAllowlistNotice(ctx, 'mystery', remote)).toBeDefined();
    expect(personaThreadSkillFields(ctx, 'builtin:reviewer', remote).automatedSkillIds).toEqual(['zcc:acme/zcc-inbox']);
    expect(personaSkillAllowlistNotice(ctx, 'builtin:reviewer', remote)).toBeUndefined();
    expect(personaSkillAllowlistNotice(ctx, 'some', remote)).toBeUndefined();
  });

  it('does not warn for ordinary local personas, unknown local ids, or no persona', () => {
    expect(personaSkillAllowlistNotice(ctx, 'open', local)).toBeUndefined();
    expect(personaSkillAllowlistNotice(ctx, 'some', local)).toBeUndefined();
    expect(personaSkillAllowlistNotice(ctx, 'missing', local)).toBeUndefined();
    expect(personaSkillAllowlistNotice(ctx)).toBeUndefined();
  });

  it('emits a system/operation timeline event and a threads:event; swallows store failures', () => {
    const emit = vi.fn();
    const c = { db: {}, hub: { emit } } as never;
    patch.events.length = 0;
    emitPersonaSkillNotice(c, 't9', undefined);
    expect(patch.events).toEqual([]);
    emitPersonaSkillNotice(c, 't9', 'careful');
    expect(patch.events[0]).toMatchObject({ threadId: 't9', type: 'system/operation', payload: { operation: 'persona_skill_allowlist', status: 'warning', message: 'careful' } });
    expect(emit).toHaveBeenCalledWith('threads:event', expect.objectContaining({ threadId: 't9', sequence: 7, kind: 'thread.event' }));
    patch.appendThrows = true;
    expect(() => emitPersonaSkillNotice(c, 't9', 'careful')).not.toThrow();
    patch.appendThrows = false;
    const source = readFileSync(new URL('./thread-create.ts', import.meta.url), 'utf8');
    expect(source).toContain('emitPersonaSkillNotice(ctx, args.thread.id, personaSkillAllowlistNotice(');
  });
});

describe('runtime-child import boundary', () => {
  it('thread-create must not import the Electron-bound persona store', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('./thread-create.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/persona-store/);
  });
});
