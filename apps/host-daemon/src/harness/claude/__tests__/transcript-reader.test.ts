import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { encodeProjectCwd } from '@zana-ai/zcc-domain/path-encoding';
import {
  encodeProjectDir,
  transcriptPath,
  extractLastAssistantText,
  readLastAssistantText,
  buildSessionDigest,
  readSessionDigest,
  buildSessionStats
} from '../transcript-reader.js';

describe('encodeProjectCwd (shared canonical)', () => {
  it('replaces every non-alphanumeric char with a dash (slash, dot, underscore)', () => {
    // Verified against real ~/.claude/projects dir names.
    expect(encodeProjectCwd('/Users/grebmann/Documents/claude-workspace/zana-command-center')).toBe(
      '-Users-grebmann-Documents-claude-workspace-zana-command-center'
    );
    expect(encodeProjectCwd('/Users/grebmann/.aisuite/notebook')).toBe(
      '-Users-grebmann--aisuite-notebook'
    );
    expect(encodeProjectCwd('/Users/grebmann/.npm/_npx/x/node_modules')).toBe(
      '-Users-grebmann--npm--npx-x-node-modules'
    );
  });

  it('correctly encodes paths with dots and underscores (bugfix vs old encodeCwd)', () => {
    // The OLD claude.ts encodeCwd only replaced `/` → would produce WRONG encoding.
    // The CORRECT encoding collapses `.` and `_` to `-` as well.
    const pathWithSpecialChars = '/Users/x/my.app_dir';
    expect(encodeProjectCwd(pathWithSpecialChars)).toBe('-Users-x-my-app-dir');
    // Dots and underscores are non-alphanumeric → collapsed to dashes.
    expect(encodeProjectCwd(pathWithSpecialChars)).not.toContain('.');
    expect(encodeProjectCwd(pathWithSpecialChars)).not.toContain('_');
  });
});

describe('encodeProjectDir (backward-compatible re-export)', () => {
  it('delegates to encodeProjectCwd and produces identical output', () => {
    const testPath = '/Users/grebmann/Documents/claude-workspace/zana-command-center';
    expect(encodeProjectDir(testPath)).toBe(encodeProjectCwd(testPath));

    const pathWithSpecialChars = '/Users/x/my.app_dir';
    expect(encodeProjectDir(pathWithSpecialChars)).toBe(encodeProjectCwd(pathWithSpecialChars));
  });
});

describe('transcriptPath', () => {
  it('builds ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl', () => {
    const p = transcriptPath('/tmp/proj', 'abc-123');
    expect(p).toMatch(/\.claude\/projects\/-tmp-proj\/abc-123\.jsonl$/);
  });

  it('returns null without a claudeSessionId (nothing to resume)', () => {
    expect(transcriptPath('/tmp/proj', undefined)).toBeNull();
  });
});

describe('extractLastAssistantText', () => {
  const asst = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  const tool = () => ({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } });
  const user = (text: string) => ({ type: 'user', message: { content: [{ type: 'text', text }] } });

  it('returns the most recent assistant text block', () => {
    expect(extractLastAssistantText([asst('first'), user('reply'), asst('second')])).toBe('second');
  });

  it('falls back to the prior text when the last assistant turn is a tool_use', () => {
    // The spike edge case: an agent mid-tool has no trailing prose; we keep the
    // last prose it spoke rather than returning ''.
    expect(extractLastAssistantText([asst('let me check'), tool()])).toBe('let me check');
  });

  it('ignores user and system lines', () => {
    expect(extractLastAssistantText([user('do X'), asst('done'), user('thanks')])).toBe('done');
  });

  it('returns empty string when there is no assistant text at all', () => {
    expect(extractLastAssistantText([user('hi'), tool()])).toBe('');
    expect(extractLastAssistantText([])).toBe('');
  });

  it('keeps the TAIL when the text exceeds maxChars (closing line matters most)', () => {
    const long = 'A'.repeat(50) + 'TAIL';
    expect(extractLastAssistantText([asst(long)], 4)).toBe('TAIL');
  });
});

describe('buildSessionDigest', () => {
  // Real transcripts: a typed user prompt is a plain STRING; an assistant turn
  // is an array of text / thinking / tool_use blocks; a tool_result arrives as a
  // user line whose content is an array (echo we drop).
  const userPrompt = (text: string) => ({ type: 'user', message: { content: text } });
  const toolResult = () => ({ type: 'user', message: { content: [{ type: 'tool_result' }] } });
  const asst = (...blocks: Array<{ type?: string; text?: string; name?: string }>) => ({
    type: 'assistant',
    message: { content: blocks }
  });

  it('tags roles, joins assistant prose, and lists tools run (deduped)', () => {
    const digest = buildSessionDigest([
      userPrompt('fix the login bug'),
      asst({ type: 'thinking', text: 'hmm' }, { type: 'text', text: 'On it.' }),
      asst({ type: 'tool_use', name: 'Edit' }, { type: 'tool_use', name: 'Edit' }, { type: 'tool_use', name: 'Bash' }),
      toolResult(),
      asst({ type: 'text', text: 'Fixed and tested.' })
    ]);
    expect(digest).toBe(
      'User: fix the login bug\n\nAssistant: On it.\n\nAssistant ran: Edit, Bash\n\nAssistant: Fixed and tested.'
    );
    // thinking blocks and tool_result echoes never appear.
    expect(digest).not.toContain('hmm');
    expect(digest).not.toContain('tool_result');
  });

  it('clamps an oversized block but keeps the rest of the arc', () => {
    const digest = buildSessionDigest([userPrompt('A'.repeat(50)), asst({ type: 'text', text: 'short' })], {
      perBlockChars: 10
    });
    expect(digest).toContain('User: AAAAAAAAAA…');
    expect(digest).toContain('Assistant: short');
  });

  it('keeps the TAIL when the whole digest exceeds maxChars', () => {
    const digest = buildSessionDigest([userPrompt('oldest'), asst({ type: 'text', text: 'NEWEST' })], {
      maxChars: 16
    });
    expect(digest.endsWith('NEWEST')).toBe(true);
    expect(digest).not.toContain('oldest');
  });

  it('returns empty string when nothing summarizable is present', () => {
    expect(buildSessionDigest([toolResult(), asst({ type: 'tool_use', name: 'Read' })])).toContain(
      'Assistant ran: Read'
    );
    expect(buildSessionDigest([])).toBe('');
  });
});

describe('readSessionDigest (integration over a real file)', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reads a role-tagged digest of the whole conversation', async () => {
    dir = mkdtempSync(join(tmpdir(), 'transcript-'));
    const file = join(dir, 'session.jsonl');
    writeFileSync(
      file,
      [
        { type: 'user', message: { content: 'do X' } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'doing X' }] } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write' }] } }
      ]
        .map((l) => JSON.stringify(l))
        .join('\n')
    );
    const digest = await readSessionDigest(file);
    expect(digest).toContain('User: do X');
    expect(digest).toContain('Assistant: doing X');
    expect(digest).toContain('Assistant ran: Write');
  });

  it('returns empty string for a missing file (never throws)', async () => {
    expect(await readSessionDigest('/no/such/file.jsonl')).toBe('');
  });
});

describe('readLastAssistantText (integration over a real file)', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const writeJsonl = (lines: object[]): string => {
    dir = mkdtempSync(join(tmpdir(), 'transcript-'));
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'));
    return file;
  };

  it('reads the last assistant prose from a JSONL transcript', async () => {
    const file = writeJsonl([
      { type: 'user', message: { content: [{ type: 'text', text: 'fix the bug' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done — want me to commit?' }] } }
    ]);
    expect(await readLastAssistantText(file)).toBe('Done — want me to commit?');
  });

  it('returns empty string for a missing file (never throws)', async () => {
    expect(await readLastAssistantText('/no/such/file.jsonl')).toBe('');
  });

  it('survives a truncated final line (live append-only file)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'transcript-'));
    const file = join(dir, 'session.jsonl');
    writeFileSync(
      file,
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'settled' }] } }) +
        '\n{"type":"assistant","message":{"content":[{"type":"te'  // half-written line
    );
    expect(await readLastAssistantText(file)).toBe('settled');
  });
});

describe('buildSessionStats', () => {
  const asst = (over: Record<string, unknown>) => ({ type: 'assistant', message: over });

  it('takes model + context from the LATEST assistant turn, not the first', () => {
    const stats = buildSessionStats([
      asst({ model: 'claude-sonnet-4-5-20250929', usage: { input_tokens: 10, cache_read_input_tokens: 100 } }),
      asst({ model: 'claude-opus-4-8', usage: { input_tokens: 5, cache_read_input_tokens: 40000, output_tokens: 20 } })
    ]);
    expect(stats.model).toBe('claude-opus-4-8');
    // context = latest turn's input + cache_read (5 + 40000), NOT a sum of turns
    expect(stats.contextTokens).toBe(40005);
  });

  it('sums cost across turns and only reports it when a rate matched', () => {
    const stats = buildSessionStats([
      asst({ model: 'claude-sonnet-4-5', usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } })
    ]);
    // sonnet: $3/M in + $15/M out = $18 for 1M each
    expect(stats.costUsd).toBeCloseTo(18, 5);

    const unknown = buildSessionStats([asst({ model: 'mystery-model', usage: { input_tokens: 500 } })]);
    expect(unknown.costUsd).toBeUndefined();
    expect(unknown.contextTokens).toBe(500);
  });

  it('prices opus 4.x at the current $5/$25 rate (not retired Claude 3 $15/$75)', () => {
    const stats = buildSessionStats([
      asst({ model: 'claude-opus-4-8', usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } })
    ]);
    // opus 4.x: $5/M in + $25/M out = $30 for 1M each
    expect(stats.costUsd).toBeCloseTo(30, 5);
  });

  it('prices cache reads at 0.1× and cache creation by TTL (1.25× 5m, 2× 1h)', () => {
    const stats = buildSessionStats([
      asst({
        model: 'claude-opus-4-8',
        usage: {
          input_tokens: 1_000_000, // fresh input @ $5/M          = $5
          cache_read_input_tokens: 1_000_000, // @ 0.1×$5/M       = $0.5
          cache_creation_input_tokens: 2_000_000, // split below
          cache_creation: {
            ephemeral_5m_input_tokens: 1_000_000, // @ 1.25×$5/M  = $6.25
            ephemeral_1h_input_tokens: 1_000_000 // @ 2×$5/M      = $10
          },
          output_tokens: 1_000_000 // @ $25/M                     = $25
        }
      })
    ]);
    expect(stats.costUsd).toBeCloseTo(5 + 0.5 + 6.25 + 10 + 25, 5);
    // context = fresh + all cache creation + cache read
    expect(stats.contextTokens).toBe(4_000_000);
  });

  it('bills cache creation as 5m when the TTL breakdown is absent (old transcripts)', () => {
    const stats = buildSessionStats([
      asst({
        model: 'claude-opus-4-8',
        usage: { cache_creation_input_tokens: 1_000_000 } // no cache_creation sub-object
      })
    ]);
    // whole lump treated as 5-min write: 1.25 × $5/M = $6.25
    expect(stats.costUsd).toBeCloseTo(6.25, 5);
  });

  it('dedupes files by path keeping the last op, most-recent first', () => {
    const stats = buildSessionStats([
      asst({ content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a/x.ts' } }] }),
      asst({ content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a/y.ts' } }] }),
      asst({ content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/a/x.ts' } }] })
    ]);
    // x re-touched last → moves to front, op upgrades R→W
    expect(stats.files).toEqual([
      { path: '/a/x.ts', op: 'W' },
      { path: '/a/y.ts', op: 'R' }
    ]);
  });

  it('maps Write→C, Edit/NotebookEdit→W, Read→R and ignores non-file tools', () => {
    const stats = buildSessionStats([
      asst({
        content: [
          { type: 'tool_use', name: 'Write', input: { file_path: '/new.ts' } },
          { type: 'tool_use', name: 'NotebookEdit', input: { notebook_path: '/nb.ipynb' } },
          { type: 'tool_use', name: 'Bash', input: {} }
        ]
      })
    ]);
    expect(stats.files).toEqual([
      { path: '/nb.ipynb', op: 'W' },
      { path: '/new.ts', op: 'C' }
    ]);
  });

  it('takes the queue from the most recent TodoWrite and drops empty items', () => {
    const stats = buildSessionStats([
      asst({ content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'old', status: 'pending' }] } }] }),
      asst({
        content: [
          {
            type: 'tool_use',
            name: 'TodoWrite',
            input: {
              todos: [
                { content: 'Write tests', status: 'in_progress' },
                { content: '', status: 'pending' },
                { activeForm: 'Fixing lint', status: 'pending' }
              ]
            }
          }
        ]
      })
    ]);
    expect(stats.queue).toEqual([
      { text: 'Write tests', status: 'in_progress' },
      { text: 'Fixing lint', status: 'pending' }
    ]);
  });

  it('returns empty lists / undefined fields for a transcript with no usable data', () => {
    // An assistant line with an empty content array carries no prompt, tokens,
    // tool call, or file op — every scalar counter stays undefined.
    const stats = buildSessionStats([{ type: 'assistant', message: { content: [] } }]);
    expect(stats).toEqual({
      model: undefined,
      contextTokens: undefined,
      costUsd: undefined,
      tokens: undefined,
      promptCount: undefined,
      toolCalls: undefined,
      mcpCalls: undefined,
      files: [],
      queue: []
    });
  });

  it('counts typed prompts, tool calls, and the MCP subset', () => {
    const stats = buildSessionStats([
      { type: 'user', message: { content: 'first prompt' } },
      asst({ content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a' } }] }),
      asst({ content: [{ type: 'tool_use', name: 'mcp__zcc-inbox__inbox_push' }] }),
      // A tool_result echo (array content) is NOT a human prompt.
      { type: 'user', message: { content: [{ type: 'tool_result' }] } as never } as never,
      { type: 'user', message: { content: 'second prompt' } }
    ]);
    expect(stats.promptCount).toBe(2);
    expect(stats.toolCalls).toBe(2);
    expect(stats.mcpCalls).toBe(1);
  });

  it('sums lifetime token totals per billing bucket across turns', () => {
    const stats = buildSessionStats([
      asst({
        model: 'claude-sonnet-4-5',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 20
        }
      }),
      asst({
        model: 'claude-sonnet-4-5',
        usage: {
          input_tokens: 3,
          output_tokens: 7,
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 4
        }
      })
    ]);
    // Lifetime totals: summed across BOTH turns (unlike contextTokens which is
    // the latest turn's snapshot: 3 + 4 + 50 = 57).
    expect(stats.tokens).toEqual({ input: 13, output: 12, cacheRead: 150, cacheWrite: 24 });
    expect(stats.contextTokens).toBe(57);
  });

  it('reports token totals even for an unknown model (tokens spent regardless of price)', () => {
    const stats = buildSessionStats([
      asst({ model: 'mystery-model', usage: { input_tokens: 500, output_tokens: 200 } })
    ]);
    expect(stats.costUsd).toBeUndefined(); // no rate matched
    expect(stats.tokens).toEqual({ input: 500, output: 200, cacheRead: 0, cacheWrite: 0 });
  });
});
