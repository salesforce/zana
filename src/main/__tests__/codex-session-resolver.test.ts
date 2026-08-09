/**
 * CodexSessionResolver tests. Builds a synthetic `~/.codex/sessions`-shaped tree
 * in a tmp dir and verifies the detect-not-mint heuristic: match a rollout by
 * (session_meta.cwd, birthtime ≥ spawn) and cache the result per key.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexSessionResolver } from '../codex-session-resolver.js';

let root: string;

function writeRollout(dateKey: string, uuid: string, cwd: string): string {
  const dir = join(root, dateKey);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `rollout-${dateKey.replace(/\//g, '-')}T00-00-00-${uuid}.jsonl`);
  const meta = JSON.stringify({
    timestamp: '2026-07-17T00:00:00Z',
    type: 'session_meta',
    payload: { id: uuid, cwd }
  });
  const asst = JSON.stringify({
    type: 'response_item',
    payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] }
  });
  writeFileSync(file, `${meta}\n${asst}\n`);
  return file;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-resolver-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('CodexSessionResolver', () => {
  it('matches a rollout by cwd and returns its minted UUID + path', async () => {
    const uuid = '019c668c-0a8e-79b0-9ee8-348f7e2665d9';
    const cwd = '/Users/me/project-a';
    const path = writeRollout('2026/07/17', uuid, cwd);
    const resolver = new CodexSessionResolver({ root, now: () => Date.parse('2026-07-17T12:00:00Z') });

    const match = await resolver.resolve('sess-1', cwd, Date.parse('2026-07-17T00:00:00Z') - 10_000);
    expect(match).toEqual({ sessionId: uuid, rolloutPath: path });
  });

  it('does not match a rollout in a different cwd', async () => {
    writeRollout('2026/07/17', '019c668c-0a8e-79b0-9ee8-348f7e2665d9', '/Users/me/project-a');
    const resolver = new CodexSessionResolver({ root, now: () => Date.parse('2026-07-17T12:00:00Z') });

    const match = await resolver.resolve('sess-1', '/Users/me/OTHER', Date.parse('2026-07-17T00:00:00Z') - 10_000);
    expect(match).toBeNull();
  });

  it('caches a successful match (per key) and exposes forget()', async () => {
    const cwd = '/Users/me/project-a';
    writeRollout('2026/07/17', '019c668c-0a8e-79b0-9ee8-348f7e2665d9', cwd);
    const resolver = new CodexSessionResolver({ root, now: () => Date.parse('2026-07-17T12:00:00Z') });

    await resolver.resolve('sess-1', cwd, Date.parse('2026-07-17T00:00:00Z') - 10_000);
    expect(resolver.size).toBe(1);
    resolver.forget('sess-1');
    expect(resolver.size).toBe(0);
  });

  it('returns null (uncached) when no rollout exists yet, then matches once it appears', async () => {
    const cwd = '/Users/me/project-a';
    const resolver = new CodexSessionResolver({ root, now: () => Date.parse('2026-07-17T12:00:00Z') });
    const spawnedAt = Date.parse('2026-07-17T00:00:00Z') - 10_000;

    expect(await resolver.resolve('sess-1', cwd, spawnedAt)).toBeNull();
    expect(resolver.size).toBe(0); // negative result NOT cached

    writeRollout('2026/07/17', '019c668c-0a8e-79b0-9ee8-348f7e2665d9', cwd);
    const match = await resolver.resolve('sess-1', cwd, spawnedAt);
    expect(match?.sessionId).toBe('019c668c-0a8e-79b0-9ee8-348f7e2665d9');
  });

  it('never throws when the sessions root is absent', async () => {
    const resolver = new CodexSessionResolver({ root: join(root, 'nope'), now: () => 0 });
    expect(await resolver.resolve('sess-1', '/x', 0)).toBeNull();
  });
});
