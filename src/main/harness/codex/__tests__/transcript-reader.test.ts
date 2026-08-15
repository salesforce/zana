/**
 * Codex rollout-transcript reader tests. Runs against a committed fixture
 * (`fixtures/codex-rollout-sample.jsonl`) that was distilled from a REAL
 * codex-cli 0.140.0 rollout file, so the parser is pinned to the actual on-disk
 * schema, not an invented one. Mirrors the coverage of the Claude
 * transcript-reader tests: last-text, digest, stats (tokens/cost/files), and the
 * never-throws contract on missing/garbage input.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  parseCodexJsonl,
  extractLastAssistantTextCodex,
  buildSessionDigestCodex,
  buildSessionStatsCodex,
  readLastAssistantTextCodex,
  readSessionStatsCodex,
  readSessionDigestCodex
} from '../transcript-reader.js';

const FIXTURE = join(__dirname, 'fixtures', 'codex-rollout-sample.jsonl');
const raw = readFileSync(FIXTURE, 'utf8');
const lines = parseCodexJsonl(raw);

describe('parseCodexJsonl', () => {
  it('parses every non-blank line of the fixture', () => {
    expect(lines.length).toBe(6);
    expect(lines[0].type).toBe('session_meta');
  });

  it('skips blank and malformed lines without throwing', () => {
    const messy = `\n{"type":"session_meta","payload":{}}\nnot json\n\n{"type":"turn_context","payload":{"type":"turn_context","model":"x"}}\n`;
    const parsed = parseCodexJsonl(messy);
    expect(parsed.length).toBe(2);
  });
});

describe('extractLastAssistantTextCodex', () => {
  it('returns the assistant output_text prose', () => {
    const text = extractLastAssistantTextCodex(lines);
    expect(text).toContain('scaffold a new Chrome extension React app');
  });

  it('returns "" when there is no assistant message', () => {
    const onlyUser = parseCodexJsonl(
      `{"type":"event_msg","payload":{"type":"user_message","message":"hi"}}`
    );
    expect(extractLastAssistantTextCodex(onlyUser)).toBe('');
  });

  it('keeps only the tail when longer than maxChars', () => {
    const long = 'x'.repeat(50) + 'TAIL';
    const synth = parseCodexJsonl(
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: long }] }
      })
    );
    expect(extractLastAssistantTextCodex(synth, 4).endsWith('TAIL')).toBe(true);
  });
});

describe('buildSessionDigestCodex', () => {
  it('tags user prompts, assistant prose, and tool runs', () => {
    const digest = buildSessionDigestCodex(lines);
    expect(digest).toContain('User: Build a Code editor');
    expect(digest).toContain('Assistant: I');
    expect(digest).toContain('Assistant ran: apply_patch');
  });
});

describe('buildSessionStatsCodex', () => {
  const stats = buildSessionStatsCodex(lines);

  it('reads the model from turn_context', () => {
    expect(stats.model).toBe('gpt-5.2-codex');
  });

  it('maps cumulative token totals into the neutral breakdown', () => {
    // fresh input = total input (15111236) - cached (14242304) = 868932
    expect(stats.tokens).toEqual({
      input: 868932,
      output: 136720,
      cacheRead: 14242304,
      cacheWrite: 0
    });
  });

  it('uses last_token_usage.input_tokens for the live context size', () => {
    expect(stats.contextTokens).toBe(97354);
  });

  it('prices a known model (gpt-5.2-codex → codex rate)', () => {
    // fresh 868932 @ $1.25/M + cacheRead 14242304 @ $0.125/M + output 136720 @ $10/M
    const expected =
      (868932 / 1e6) * 1.25 + (14242304 / 1e6) * 1.25 * 0.1 + (136720 / 1e6) * 10;
    expect(stats.costUsd).toBeCloseTo(expected, 4);
  });

  it('extracts apply_patch file touches', () => {
    expect(stats.files).toContainEqual({ path: 'src/components/EditorPane.tsx', op: 'W' });
  });

  it('parses Add/Update/Delete headers into C/W ops', () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: a/new.ts',
      '*** Update File: b/mod.ts',
      '*** Delete File: c/gone.ts',
      '*** End Patch'
    ].join('\n');
    const synth = parseCodexJsonl(
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'custom_tool_call', name: 'apply_patch', input: patch }
      })
    );
    const s = buildSessionStatsCodex(synth);
    expect(s.files).toEqual([
      // most-recent-first (reversed insertion order)
      { path: 'c/gone.ts', op: 'W' },
      { path: 'b/mod.ts', op: 'W' },
      { path: 'a/new.ts', op: 'C' }
    ]);
  });

  it('has an empty queue (Codex has no TodoWrite)', () => {
    expect(stats.queue).toEqual([]);
  });

  it('yields undefined tokens/cost when no token_count line exists', () => {
    const noTokens = parseCodexJsonl(
      `{"type":"turn_context","payload":{"type":"turn_context","model":"gpt-5"}}`
    );
    const s = buildSessionStatsCodex(noTokens);
    expect(s.tokens).toBeUndefined();
    expect(s.costUsd).toBeUndefined();
  });
});

describe('async readers — never throw', () => {
  it('readLastAssistantTextCodex reads the fixture file', async () => {
    const text = await readLastAssistantTextCodex(FIXTURE);
    expect(text).toContain('scaffold a new Chrome extension React app');
  });

  it('returns "" / null for a missing file rather than throwing', async () => {
    const missing = join(__dirname, 'fixtures', 'does-not-exist.jsonl');
    expect(await readLastAssistantTextCodex(missing)).toBe('');
    expect(await readSessionDigestCodex(missing)).toBe('');
    expect(await readSessionStatsCodex(missing)).toBeNull();
  });

  it('readSessionStatsCodex reads real token totals from the fixture', async () => {
    const s = await readSessionStatsCodex(FIXTURE);
    expect(s?.tokens?.output).toBe(136720);
  });
});
