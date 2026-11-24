import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPiApiErrorProducer, piSessionRoot } from '../api-error-producer.js';
import { PI_FIXTURE_ID as ID, piRows as rows } from '../../__tests__/fixtures/pi-api-error.js';

let root: string;
let file: string;
const session = (extra: Record<string, unknown> = {}) => ({ id: 'pty-1', cwd: '/work', nativeConversationId: ID, ...extra });
const producer = () => createPiApiErrorProducer({ root: () => root });

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-producer-')));
  mkdirSync(join(root, '--work--'));
  file = join(root, '--work--', `2026-11-24T20-03-36-004Z_${ID}.jsonl`);
  writeFileSync(file, rows.header());
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

async function run(append: string, ref = session(), p = producer()) {
  const marker = await p.markTurnStart(ref);
  appendFileSync(file, append);
  return p.check(ref, marker);
}

describe('pi api-error producer', () => {
  it('reports a final 503 as retryable server_error', async () => {
    const event = await run(rows.user('u1', 'h') + rows.error('a1', 'u1'));
    expect(event).toMatchObject({ kind: 'api-error-stop', error: 'server_error', retryable: true });
    expect((event as { text: string }).text).toContain('service unavailable');
  });

  it.each([
    ['429: {"message":"rate limited"}', 'rate_limit', true],
    ['529: {"message":"Overloaded"}', 'overloaded', true],
    ['401: {"message":"invalid api key"}', 'authentication_failed', false],
    ['weird failure', 'unknown', true]
  ])('maps %s to %s', async (message, kind, retryable) => {
    const event = await run(rows.user('u1', 'h') + rows.error('a1', 'u1', message));
    expect(event).toMatchObject({ error: kind, retryable });
  });

  it('is silent for a good turn and for a user interrupt', async () => {
    expect(await run(rows.user('u1', 'h') + rows.ok('a1', 'u1'))).toBeNull();
    expect(await run(rows.user('u2', 'a1') + rows.aborted('a2', 'u2'))).toBeNull();
  });

  it('ignores superseded retry attempts and retry-then-success', async () => {
    const body = rows.user('u1', 'h') + rows.error('a1', 'u1') + rows.tombstone('e1', 'a1') + rows.error('a2', 'e1') + rows.tombstone('e2', 'a2') + rows.ok('a3', 'e2');
    expect(await run(body)).toBeNull();
  });

  it('ignores a tombstoned final row (cancelled retry, context overflow)', async () => {
    expect(await run(rows.user('u1', 'h') + rows.error('a1', 'u1') + rows.tombstone('e1', 'a1'))).toBeNull();
  });

  it('reports the final row after tombstoned attempts', async () => {
    const body = rows.user('u1', 'h') + rows.error('a1', 'u1') + rows.tombstone('e1', 'a1') + rows.error('a2', 'e1');
    expect(await run(body)).toMatchObject({ kind: 'api-error-stop' });
  });

  it('ignores an error row from before the turn marker', async () => {
    appendFileSync(file, rows.user('u0', 'h') + rows.error('a0', 'u0'));
    expect(await run(rows.user('u1', 'a0') + rows.ok('a1', 'u1'))).toBeNull();
  });

  it('ignores an error followed by a later good assistant row', async () => {
    expect(await run(rows.error('a1', 'h') + rows.ok('a2', 'a1'))).toBeNull();
  });

  it('ignores error text that only appears in user content or a non-assistant row', async () => {
    const forged = JSON.stringify({ type: 'message', id: 'x', parentId: 'h', message: { role: 'user', stopReason: 'error', errorMessage: '429: nope' } }) + '\n'
      + JSON.stringify({ type: 'message', id: 'y', parentId: 'x', message: { role: 'toolResult', content: '429 rate limit', stopReason: 'error' } }) + '\n';
    expect(await run(forged)).toBeNull();
  });

  it('handles a partial last line and malformed rows', async () => {
    expect(await run('{not json}\n' + rows.user('u1', 'h') + '{"type":"message","id":"a1","mess')).toBeNull();
  });

  it('skips oversize lines and still finds the error row', async () => {
    const big = JSON.stringify({ type: 'x', pad: 'z'.repeat(300 * 1024) }) + '\n';
    expect(await run(big + rows.error('a1', 'h'))).toMatchObject({ kind: 'api-error-stop' });
  });

  it('reads only the bounded tail of a huge file', async () => {
    const filler = rows.user('f', 'h').repeat(20_000);
    writeFileSync(file, rows.header() + filler);
    expect(await run(rows.error('a1', 'f'))).toMatchObject({ kind: 'api-error-stop' });
  });

  it('works when the session file appears only after turn start', async () => {
    rmSync(file);
    const p = producer();
    const marker = await p.markTurnStart(session());
    expect(marker).toEqual({ offset: null });
    writeFileSync(file, rows.header() + rows.user('u1', 'h') + rows.error('a1', 'u1'));
    expect(await p.check(session(), marker)).toMatchObject({ kind: 'api-error-stop' });
  });

  it('returns null when the file was truncated or rotated after the marker', async () => {
    const p = producer();
    appendFileSync(file, rows.user('u0', 'h'));
    const marker = await p.markTurnStart(session());
    writeFileSync(file, rows.header());
    truncateSync(file, 10);
    expect(await p.check(session(), marker)).toBeNull();
  });

  it('returns null for a header id mismatch', async () => {
    writeFileSync(file, rows.header('other-session-id-0000'));
    expect(await run(rows.error('a1', 'h'))).toBeNull();
  });

  it('returns null for a missing marker, missing file, missing or unsafe id, and remote sessions', async () => {
    const p = producer();
    expect(await p.check(session(), undefined)).toBeNull();
    expect(await run(rows.error('a1', 'h'), session({ nativeConversationId: undefined }))).toBeNull();
    expect(await run(rows.error('a1', 'h'), session({ nativeConversationId: '../../etc/passwd' }))).toBeNull();
    expect(await run(rows.error('a1', 'h'), session({ nativeConversationId: '*' }))).toBeNull();
    expect(await run(rows.error('a1', 'h'), session({ remote: { host: 'h' } }))).toBeNull();
    rmSync(file);
    expect(await p.check(session(), { offset: 0 })).toBeNull();
  });

  it('refuses a symlinked session file or directory that escapes the root', async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pi-outside-')));
    try {
      const target = join(outside, `x_${ID}.jsonl`);
      writeFileSync(target, rows.header() + rows.error('a1', 'h'));
      rmSync(file);
      symlinkSync(target, file);
      expect(await producer().check(session(), { offset: 0 })).toBeNull();
      rmSync(file);
      rmSync(join(root, '--work--'), { recursive: true });
      symlinkSync(outside, join(root, '--work--'));
      expect(await producer().check(session(), { offset: 0 })).toBeNull();
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });

  it('sanitises and caps the reported text', async () => {
    const event = await run(rows.user('u1', 'h') + rows.error('a1', 'u1', `503: \u001b[31m${'x'.repeat(10_000)}\u0007`));
    const text = (event as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).not.toContain('\u001b');
  });

  it('release is a no-op and exposes a quiet period past the retry window', () => {
    const p = producer();
    expect(() => p.release('pty-1')).not.toThrow();
    expect(p.quietMs).toBeGreaterThan(14_000);
  });
});

describe('piSessionRoot', () => {
  it('prefers the session dir override, then the agent dir, then the home default', () => {
    expect(piSessionRoot({ PI_CODING_AGENT_SESSION_DIR: '/a/s' }, '/h')).toBe('/a/s');
    expect(piSessionRoot({ PI_CODING_AGENT_DIR: '/a' }, '/h')).toBe('/a/sessions');
    expect(piSessionRoot({}, '/h')).toBe('/h/.pi/agent/sessions');
  });
});
