/**
 * OpenCode transcript parsing tests. Uses row-shaped fixtures so this unit
 * suite does not depend on the native SQLite module.
 */

import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  extractLastAssistantTextOpenCode,
  buildSessionDigestOpenCode,
  buildSessionStatsOpenCode,
  buildSessionStatsOpenCodeExport,
  readLastAssistantTextOpenCode,
  readSessionDigestOpenCode,
  readSessionStatsOpenCode,
  openCodeDbPath
} from '../opencode-transcript-reader.js';

const representativeRows = [
  {
    mdata: JSON.stringify({ role: 'user' }),
    pdata: JSON.stringify({ type: 'text', text: 'Please fix the bug in server.ts' })
  },
  {
    mdata: JSON.stringify({ role: 'assistant' }),
    pdata: JSON.stringify({
      type: 'tool',
      tool: 'apply_patch',
      state: { metadata: { files: [{ relativePath: 'services/api/src/server.ts', type: 'update' }] } }
    })
  },
  {
    mdata: JSON.stringify({ role: 'assistant' }),
    pdata: JSON.stringify({ type: 'tool', tool: 'read', state: { input: { filePath: '/repo/README.md' } } })
  },
  {
    mdata: JSON.stringify({ role: 'assistant' }),
    pdata: JSON.stringify({
      type: 'tool',
      tool: 'todowrite',
      state: {
        input: {
          todos: [
            { content: 'Fix the bug', status: 'completed' },
            { content: 'Write a test', status: 'in_progress' },
            { content: 'Ship it', status: 'pending' }
          ]
        }
      }
    })
  },
  {
    mdata: JSON.stringify({ role: 'assistant' }),
    pdata: JSON.stringify({ type: 'text', text: 'Fixed the bug and added a test.' })
  }
];

describe('extractLastAssistantTextOpenCode', () => {
  it('returns the last assistant text part', () => {
    expect(extractLastAssistantTextOpenCode(representativeRows)).toBe('Fixed the bug and added a test.');
  });

  it('returns "" when there is no assistant text', () => {
    const rows = [{ mdata: JSON.stringify({ role: 'user' }), pdata: JSON.stringify({ type: 'text', text: 'hi' }) }];
    expect(extractLastAssistantTextOpenCode(rows)).toBe('');
  });

  it('keeps only the tail when longer than maxChars', () => {
    const long = 'x'.repeat(50) + 'TAIL';
    const rows = [
      { mdata: JSON.stringify({ role: 'assistant' }), pdata: JSON.stringify({ type: 'text', text: long }) }
    ];
    expect(extractLastAssistantTextOpenCode(rows, 4).endsWith('TAIL')).toBe(true);
  });
});

describe('buildSessionDigestOpenCode', () => {
  it('tags user prompts, assistant prose, and dedups tool runs', () => {
    const digest = buildSessionDigestOpenCode(representativeRows);
    expect(digest).toContain('User: Please fix the bug in server.ts');
    expect(digest).toContain('Assistant ran: apply_patch, read, todowrite');
    expect(digest).toContain('Assistant: Fixed the bug and added a test.');
  });
});

describe('buildSessionStatsOpenCode', () => {
  const sessionRow = {
    model: JSON.stringify({ id: 'gpt-5.6-sol', providerID: 'aisuite', variant: 'default' }),
    cost: 0.42,
    tokens_input: 1000,
    tokens_output: 500,
    tokens_reasoning: 20,
    tokens_cache_read: 300,
    tokens_cache_write: 50
  };
  const rows = [
    {
      mdata: JSON.stringify({ role: 'assistant' }),
      pdata: JSON.stringify({
        type: 'tool',
        tool: 'apply_patch',
        state: { metadata: { files: [{ relativePath: 'services/api/src/server.ts', type: 'update' }] } }
      })
    },
    {
      mdata: JSON.stringify({ role: 'assistant' }),
      pdata: JSON.stringify({ type: 'tool', tool: 'read', state: { input: { filePath: '/repo/README.md' } } })
    },
    {
      mdata: JSON.stringify({ role: 'assistant' }),
      pdata: JSON.stringify({
        type: 'tool',
        tool: 'todowrite',
        state: { input: { todos: [{ content: 'Ship it', status: 'pending' }] } }
      })
    }
  ];

  it('reads the model id out of the JSON blob', () => {
    expect(buildSessionStatsOpenCode(sessionRow, rows).model).toBe('gpt-5.6-sol');
  });

  it('uses session.cost when present', () => {
    expect(buildSessionStatsOpenCode(sessionRow, rows).costUsd).toBe(0.42);
  });

  it('falls back to a model-rate estimate when cost is 0', () => {
    const zero = { ...sessionRow, cost: 0 };
    const stats = buildSessionStatsOpenCode(zero, rows);
    expect(stats.costUsd).toBeGreaterThan(0);
  });

  it('sums tokens into input/output/cacheRead/cacheWrite buckets', () => {
    const tokens = buildSessionStatsOpenCode(sessionRow, rows).tokens;
    expect(tokens).toEqual({ input: 1000, output: 520, cacheRead: 300, cacheWrite: 50 });
  });

  it('leaves contextTokens undefined (no OpenCode analogue)', () => {
    expect(buildSessionStatsOpenCode(sessionRow, rows).contextTokens).toBeUndefined();
  });

  it('extracts apply_patch and read as file touches, most-recent-first', () => {
    const files = buildSessionStatsOpenCode(sessionRow, rows).files;
    expect(files).toEqual([
      { path: '/repo/README.md', op: 'R' },
      { path: 'services/api/src/server.ts', op: 'W' }
    ]);
  });

  it('maps apply_patch "add" to C and other types to W', () => {
    const addRows = [
      {
        mdata: JSON.stringify({ role: 'assistant' }),
        pdata: JSON.stringify({
          type: 'tool',
          tool: 'apply_patch',
          state: { metadata: { files: [{ relativePath: 'new.ts', type: 'add' }] } }
        })
      }
    ];
    expect(buildSessionStatsOpenCode(undefined, addRows).files).toEqual([{ path: 'new.ts', op: 'C' }]);
  });

  it('reads write/edit tool parts by filePath', () => {
    const rows2 = [
      {
        mdata: JSON.stringify({ role: 'assistant' }),
        pdata: JSON.stringify({ type: 'tool', tool: 'write', state: { input: { filePath: '/repo/a.ts' } } })
      },
      {
        mdata: JSON.stringify({ role: 'assistant' }),
        pdata: JSON.stringify({ type: 'tool', tool: 'edit', state: { input: { filePath: '/repo/b.ts' } } })
      }
    ];
    expect(buildSessionStatsOpenCode(undefined, rows2).files).toEqual([
      { path: '/repo/b.ts', op: 'W' },
      { path: '/repo/a.ts', op: 'C' }
    ]);
  });

  it('takes the latest todowrite as the queue', () => {
    expect(buildSessionStatsOpenCode(sessionRow, rows).queue).toEqual([{ text: 'Ship it', status: 'pending' }]);
  });

  it('degrades to empty files/queue and no tokens when session/rows are empty', () => {
    const stats = buildSessionStatsOpenCode(undefined, []);
    expect(stats).toEqual({
      model: undefined,
      contextTokens: undefined,
      costUsd: undefined,
      tokens: undefined,
      files: [],
      queue: []
    });
  });

  it('ignores malformed JSON blobs without throwing', () => {
    const garbage = [{ mdata: 'not json', pdata: 'also not json' }];
    expect(() => buildSessionStatsOpenCode(sessionRow, garbage)).not.toThrow();
    expect(buildSessionStatsOpenCode(sessionRow, garbage).files).toEqual([]);
  });
});

describe('buildSessionStatsOpenCodeExport', () => {
  it('projects model, version, agent, and lifetime usage from CLI export JSON', () => {
    expect(buildSessionStatsOpenCodeExport({
      info: {
        model: { id: 'gpt-5.6-terra' },
        version: '1.18.10',
        agent: 'build',
        cost: 0,
        tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 300, write: 0 } }
      },
      messages: []
    })).toMatchObject({
      model: 'gpt-5.6-terra',
      harnessVersion: '1.18.10',
      agent: 'build',
      tokens: { input: 100, output: 25, cacheRead: 300, cacheWrite: 0 }
    });
  });
});

describe('openCodeDbPath', () => {
  it('honors XDG_DATA_HOME when set', () => {
    const prev = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = '/custom/data';
    try {
      expect(openCodeDbPath()).toBe('/custom/data/opencode/opencode.db');
    } finally {
      if (prev === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = prev;
    }
  });

  it('falls back to ~/.local/share when unset', () => {
    const prev = process.env.XDG_DATA_HOME;
    delete process.env.XDG_DATA_HOME;
    try {
      expect(openCodeDbPath(homedir())).toBe(join(homedir(), '.local', 'share', 'opencode', 'opencode.db'));
    } finally {
      if (prev !== undefined) process.env.XDG_DATA_HOME = prev;
    }
  });
});

describe('async readers — never throw', () => {
  it('returns "" / null for a missing db rather than throwing', async () => {
    const missing = '/tmp/zcc-does-not-exist-opencode.db';
    expect(await readLastAssistantTextOpenCode('anything', { dbPath: missing })).toBe('');
    expect(await readSessionDigestOpenCode('anything', { dbPath: missing })).toBe('');
    expect(await readSessionStatsOpenCode('anything', { dbPath: missing })).toBeNull();
  });
});
