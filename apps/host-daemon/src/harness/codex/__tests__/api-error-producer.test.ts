import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCodexApiErrorProducer, CODEX_QUIET_MS } from '../api-error-producer.js';
import { readRolloutTail, ROLLOUT_TAIL_BYTES, rolloutSize } from '../rollout-reader.js';
import { CodexSessionResolver, codexSessionsRoot } from '../session-resolver.js';

const ID = '01a208f1-78be-76e1-8a80-e6ab2ee3a6d6';
const line = (v: unknown) => `${JSON.stringify(v)}\n`;
const meta = (id = ID, cwd = '/work') => line({ type: 'session_meta', payload: { id, cwd } });
const started = line({ type: 'event_msg', payload: { type: 'task_started' } });
const failedTurn = line({ type: 'event_msg', payload: { type: 'task_complete', error: { message: 'cap', codex_error_info: 'server_overloaded' } } });
const okTurn = line({ type: 'event_msg', payload: { type: 'task_complete' } });

let home: string;
let root: string;
let file: string;
const session = (extra: Record<string, unknown> = {}) => ({ id: 'pty-1', cwd: '/work', createdAt: Date.now(), codexSessionId: ID, ...extra });

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'codex-prod-')));
  root = join(home, 'sessions');
  const dir = join(root, '2026', '11', '23');
  mkdirSync(dir, { recursive: true });
  file = join(dir, `rollout-2026-11-23T10-00-00-${ID}.jsonl`);
  writeFileSync(file, meta());
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('codexSessionsRoot', () => {
  it('honours CODEX_HOME and falls back to ~/.codex', () => {
    expect(codexSessionsRoot({ CODEX_HOME: '/x/y' } as NodeJS.ProcessEnv)).toBe('/x/y/sessions');
    expect(codexSessionsRoot({ CODEX_HOME: '  ' } as NodeJS.ProcessEnv)).toMatch(/\.codex\/sessions$/);
    expect(codexSessionsRoot({} as NodeJS.ProcessEnv)).toMatch(/\.codex\/sessions$/);
  });
  it('resolver follows a CODEX_HOME set after construction', async () => {
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = home;
    try {
      const resolver = new CodexSessionResolver();
      expect(resolver.root).toBe(root);
      expect((await resolver.resolve('k', '/work', Date.now(), ID))?.rolloutPath).toBe(file);
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous;
    }
  });
  it('finds a resumed older session by its known id despite an old birthtime', async () => {
    const resolver = new CodexSessionResolver({ root });
    expect((await resolver.resolve('k', '/work', Date.now() + 86_400_000, ID))?.sessionId).toBe(ID);
    expect(await new CodexSessionResolver({ root }).resolve('k2', '/work', Date.now() + 86_400_000)).toBeNull();
  });
});

describe('rollout reader', () => {
  it('reads the bounded tail of a large file and reports offsets', async () => {
    appendFileSync(file, line({ type: 'response_item', payload: { pad: 'x'.repeat(ROLLOUT_TAIL_BYTES * 2) } }) + started + failedTurn);
    const read = await readRolloutTail(file, root, ID);
    expect(read?.tail.length).toBe(ROLLOUT_TAIL_BYTES);
    expect(read!.tailStartOffset + read!.tail.length).toBe(read!.size);
  });
  it('rejects a symlinked rollout, a path outside the root, a non-file, a missing file and a different session id', async () => {
    const link = join(root, 'link.jsonl');
    symlinkSync(file, link);
    expect(await readRolloutTail(link, root, ID)).toBeNull();
    const outside = join(tmpdir(), `outside-${process.pid}.jsonl`);
    writeFileSync(outside, meta());
    try {
      expect(await readRolloutTail(outside, root, ID)).toBeNull();
      expect(await rolloutSize(outside, root)).toBeNull();
    } finally { rmSync(outside, { force: true }); }
    expect(await readRolloutTail(join(root, '2026'), root, ID)).toBeNull();
    expect(await readRolloutTail(join(root, 'nope.jsonl'), root, ID)).toBeNull();
    expect(await readRolloutTail(file, root, 'other-id')).toBeNull();
    expect(await rolloutSize(file, root)).toBeGreaterThan(0);
  });
  it('rejects a file whose first line is not a session_meta', async () => {
    writeFileSync(file, line({ type: 'event_msg' }));
    expect(await readRolloutTail(file, root, ID)).toBeNull();
    writeFileSync(file, 'garbage');
    expect(await readRolloutTail(file, root, ID)).toBeNull();
  });
  it('rejects a path whose directory symlink leaves the root', async () => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'elsewhere-')));
    writeFileSync(join(elsewhere, 'r.jsonl'), meta());
    symlinkSync(elsewhere, join(root, 'escape'));
    try {
      expect(await readRolloutTail(join(root, 'escape', 'r.jsonl'), root, ID)).toBeNull();
    } finally { rmSync(elsewhere, { recursive: true, force: true }); }
  });
});

describe('Codex api-error producer', () => {
  const make = () => createCodexApiErrorProducer({ resolver: new CodexSessionResolver({ root }) });

  it('reports the quiet period', () => {
    expect(make().quietMs).toBe(CODEX_QUIET_MS);
    expect(createCodexApiErrorProducer({ quietMs: 5 }).quietMs).toBe(5);
  });

  it('detects the failed turn that began at the marker', async () => {
    const producer = make();
    const marker = await producer.markTurnStart(session());
    appendFileSync(file, started + failedTurn);
    expect(await producer.check(session(), marker)).toMatchObject({ kind: 'api-error-stop', error: 'overloaded', retryable: true });
  });

  it('stays silent on a good turn, and ignores an older failure', async () => {
    appendFileSync(file, started + failedTurn);
    const producer = make();
    const marker = await producer.markTurnStart(session());
    appendFileSync(file, started + okTurn);
    expect(await producer.check(session(), marker)).toBeNull();
  });

  it('follows a resumed older session found by id', async () => {
    appendFileSync(file, started + okTurn);
    const producer = make();
    const marker = await producer.markTurnStart(session({ createdAt: Date.now() + 1e9 }));
    appendFileSync(file, started + failedTurn);
    expect(await producer.check(session({ createdAt: Date.now() + 1e9 }), marker)).toMatchObject({ kind: 'api-error-stop' });
  });

  it('first turn with the rollout not yet written: accepts only a single-turn file', async () => {
    const producer = createCodexApiErrorProducer({ resolver: new CodexSessionResolver({ root: join(home, 'nothing-yet') }) });
    const marker = await producer.markTurnStart(session());
    expect(marker).toEqual({ offset: null });
    expect(await producer.check(session(), marker)).toBeNull();
    const lateProducer = make();
    appendFileSync(file, started + failedTurn);
    expect(await lateProducer.check(session(), { offset: null })).toMatchObject({ kind: 'api-error-stop' });
    appendFileSync(file, started + okTurn);
    expect(await lateProducer.check(session(), { offset: null })).toBeNull();
  });

  it('returns null with no marker, no rollout, a mismatched id or a symlinked file', async () => {
    const producer = make();
    expect(await producer.check(session(), undefined)).toBeNull();
    expect(await producer.check(session({ cwd: '/elsewhere', codexSessionId: undefined }), { offset: 0 })).toBeNull();
    writeFileSync(file, meta('someone-else'));
    expect(await make().check(session(), { offset: 0 })).toBeNull();
  });

  it('re-resolves each turn and releases state on exit', async () => {
    const resolver = new CodexSessionResolver({ root });
    const producer = createCodexApiErrorProducer({ resolver });
    await producer.markTurnStart(session());
    expect(resolver.size).toBe(1);
    producer.release('pty-1');
    expect(resolver.size).toBe(0);
    await producer.markTurnStart(session());
    await producer.markTurnStart(session());
    expect(resolver.size).toBe(1);
  });
});
