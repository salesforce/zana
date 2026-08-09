/**
 * TranscriptSource dispatch-seam tests. Verifies the seam routes reads to the
 * right per-provider reader by capability: Claude → derived path + Claude reader;
 * Codex → resolved rollout + Codex reader; no-transcript profile → empty/null.
 *
 * Uses a tmp `~/.codex/sessions` tree + a tmp `~/.claude/projects` tree so both
 * real readers run end-to-end through the seam (no reader mocking).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { CodexSessionResolver } from '../codex-session-resolver.js';
import { TranscriptSource } from '../transcript-source.js';
import { encodeProjectCwd } from '../../shared/path-encoding.js';

let codexRoot: string;

function writeCodexRollout(dateKey: string, uuid: string, cwd: string): void {
  const dir = join(codexRoot, dateKey);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `rollout-${dateKey.replace(/\//g, '-')}T00-00-00-${uuid}.jsonl`);
  const meta = JSON.stringify({ type: 'session_meta', payload: { id: uuid, cwd } });
  const asst = JSON.stringify({
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'codex says hello' }]
    }
  });
  writeFileSync(file, `${meta}\n${asst}\n`);
}

beforeEach(() => {
  codexRoot = mkdtempSync(join(tmpdir(), 'ts-codex-'));
});
afterEach(() => {
  rmSync(codexRoot, { recursive: true, force: true });
});

describe('TranscriptSource', () => {
  it('routes a Codex session to the Codex reader via the resolver', async () => {
    const cwd = '/Users/me/proj-codex';
    const uuid = '019c668c-0a8e-79b0-9ee8-348f7e2665d9';
    writeCodexRollout('2026/07/17', uuid, cwd);
    const resolver = new CodexSessionResolver({
      root: codexRoot,
      now: () => Date.parse('2026-07-17T12:00:00Z')
    });
    const src = new TranscriptSource(resolver);

    const text = await src.readLastTurn({
      id: 'sess-codex',
      profile: 'codex',
      cwd,
      createdAt: Date.parse('2026-07-17T00:00:00Z') - 10_000
    });
    expect(text).toBe('codex says hello');
  });

  it('returns "" / null for a no-transcript profile (shell)', async () => {
    const src = new TranscriptSource();
    expect(await src.readLastTurn({ id: 's', profile: 'shell', cwd: '/x' })).toBe('');
    expect(await src.readDigest({ id: 's', profile: 'shell', cwd: '/x' })).toBe('');
    expect(await src.readStats({ id: 's', profile: 'shell', cwd: '/x' })).toBeNull();
  });

  it('returns "" for a Codex session whose rollout has not appeared yet', async () => {
    const resolver = new CodexSessionResolver({
      root: codexRoot,
      now: () => Date.parse('2026-07-17T12:00:00Z')
    });
    const src = new TranscriptSource(resolver);
    const text = await src.readLastTurn({
      id: 'sess-x',
      profile: 'codex',
      cwd: '/Users/me/nothing-here',
      createdAt: Date.parse('2026-07-17T00:00:00Z')
    });
    expect(text).toBe('');
  });

  it('routes a Claude session to the derived-path Claude reader', async () => {
    // Write a Claude transcript at the derived path the seam will compute.
    const cwd = mkdtempSync(join(tmpdir(), 'ts-claude-cwd-'));
    const claudeSessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const projDir = join(homedir(), '.claude', 'projects', encodeProjectCwd(cwd));
    const transcript = join(projDir, `${claudeSessionId}.jsonl`);
    mkdirSync(projDir, { recursive: true });
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'claude says hello' }] }
    });
    writeFileSync(transcript, `${line}\n`);

    try {
      const src = new TranscriptSource();
      const text = await src.readLastTurn({ id: 'sess-claude', profile: 'claude', cwd, claudeSessionId });
      expect(text).toBe('claude says hello');
    } finally {
      rmSync(transcript, { force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('fires onCodexResolved ONCE with the detected rollout id, then not again', async () => {
    const cwd = '/Users/me/proj-codex';
    const uuid = '019c668c-0a8e-79b0-9ee8-348f7e2665d9';
    writeCodexRollout('2026/07/17', uuid, cwd);
    const resolver = new CodexSessionResolver({
      root: codexRoot,
      now: () => Date.parse('2026-07-17T12:00:00Z')
    });
    const calls: Array<[string, string]> = [];
    const src = new TranscriptSource(resolver, (id, sessionId) => calls.push([id, sessionId]));
    const ref = {
      id: 'sess-codex',
      profile: 'codex' as const,
      cwd,
      createdAt: Date.parse('2026-07-17T00:00:00Z') - 10_000
    };
    // Multiple reads (any of the readLast*/digest/stats paths) must stamp once.
    await src.readLastTurn(ref);
    await src.readDigest(ref);
    await src.readLastTurn(ref);
    expect(calls).toEqual([['sess-codex', uuid]]);
    // After forget(), a later match re-fires (the session's a fresh identity).
    src.forget('sess-codex');
    await src.readLastTurn(ref);
    expect(calls).toEqual([
      ['sess-codex', uuid],
      ['sess-codex', uuid]
    ]);
  });

  it('forget() releases the Codex resolver cache entry', async () => {
    const cwd = '/Users/me/proj-codex';
    writeCodexRollout('2026/07/17', '019c668c-0a8e-79b0-9ee8-348f7e2665d9', cwd);
    const resolver = new CodexSessionResolver({
      root: codexRoot,
      now: () => Date.parse('2026-07-17T12:00:00Z')
    });
    const src = new TranscriptSource(resolver);
    await src.readLastTurn({
      id: 'sess-codex',
      profile: 'codex',
      cwd,
      createdAt: Date.parse('2026-07-17T00:00:00Z') - 10_000
    });
    expect(resolver.size).toBe(1);
    src.forget('sess-codex');
    expect(resolver.size).toBe(0);
  });
});
