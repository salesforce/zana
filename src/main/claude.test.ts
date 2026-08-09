import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// listClaudeSessions reads ~/.claude/projects — point HOME at a scratch dir so
// the test owns the transcript fixtures.
const TEST_HOME = mkdtempSync(join(tmpdir(), 'cc-claude-home-'));
vi.mock('electron', () => ({ app: { getPath: () => TEST_HOME } }));

import { extractTitle, listClaudeSessions } from './claude.js';
import { encodeProjectCwd } from '../shared/path-encoding.js';

/**
 * extractTitle pulls a session's display name out of the Claude Code transcript
 * (.jsonl). Claude writes the name as its own line type — `custom-title` for a
 * user `/rename`, `ai-title` for its auto-generated name. The resume/agents
 * pickers prefer this over the opening prompt so a renamed session shows the
 * short given name. These pin that extraction (the bug: pickers showed the long
 * first prompt for /rename'd sessions because nothing read these lines).
 */
const userLine = JSON.stringify({ type: 'user', message: { role: 'user', content: 'do a big thing' } });

describe('extractTitle', () => {
  it('returns the /rename custom-title when present', () => {
    const lines = [
      userLine,
      JSON.stringify({ type: 'ai-title', aiTitle: 'Auto generated name', sessionId: 's1' }),
      JSON.stringify({ type: 'custom-title', customTitle: 'My Renamed Session', sessionId: 's1' })
    ];
    expect(extractTitle(lines)).toBe('My Renamed Session');
  });

  it('custom-title wins even when it appears before the ai-title', () => {
    const lines = [
      JSON.stringify({ type: 'custom-title', customTitle: 'Researcher [bd399e]', sessionId: 's1' }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'List MCP tools', sessionId: 's1' })
    ];
    expect(extractTitle(lines)).toBe('Researcher [bd399e]');
  });

  it('falls back to ai-title when there is no custom-title', () => {
    const lines = [userLine, JSON.stringify({ type: 'ai-title', aiTitle: 'List MCP tools' })];
    expect(extractTitle(lines)).toBe('List MCP tools');
  });

  it('uses the latest custom-title when renamed more than once', () => {
    const lines = [
      JSON.stringify({ type: 'custom-title', customTitle: 'First Name' }),
      JSON.stringify({ type: 'custom-title', customTitle: 'Second Name' })
    ];
    expect(extractTitle(lines)).toBe('Second Name');
  });

  it('returns null when the transcript has no title lines', () => {
    expect(extractTitle([userLine, JSON.stringify({ type: 'assistant' })])).toBeNull();
  });

  it('ignores blank/whitespace titles and malformed lines', () => {
    const lines = [
      'not json',
      JSON.stringify({ type: 'custom-title', customTitle: '   ' }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Fallback Title' })
    ];
    expect(extractTitle(lines)).toBe('Fallback Title');
  });
});

/**
 * listClaudeSessions must be async + bounded: reading every (multi-MB)
 * transcript synchronously on the main event loop froze the launcher. It now
 * only fully reads the newest SESSION_READ_CAP (12) files; older ones come back
 * as lightweight stat-only rows (id + timestamps, no body parse).
 */
describe('listClaudeSessions', () => {
  const PROJECT = '/tmp/some/project';
  let dir: string;

  beforeAll(() => {
    dir = join(TEST_HOME, '.claude', 'projects', encodeProjectCwd(PROJECT));
    mkdirSync(dir, { recursive: true });
    // 15 transcripts, oldest→newest by mtime. Each carries a distinct title +
    // first prompt so we can assert which ones were actually read.
    for (let i = 0; i < 15; i++) {
      const file = join(dir, `sess-${String(i).padStart(2, '0')}.jsonl`);
      const lines = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: `prompt ${i}` } }),
        JSON.stringify({ type: 'ai-title', aiTitle: `Title ${i}` })
      ];
      writeFileSync(file, lines.join('\n'));
      // Stagger mtimes so ordering is deterministic (i=14 newest).
      const t = new Date(1_700_000_000_000 + i * 60_000);
      utimesSync(file, t, t);
    }
  });

  afterAll(() => rmSync(TEST_HOME, { recursive: true, force: true }));

  it('returns all sessions newest-first', async () => {
    const out = await listClaudeSessions(PROJECT);
    expect(out).toHaveLength(15);
    expect(out[0].id).toBe('sess-14');
    expect(out[14].id).toBe('sess-00');
  });

  it('fully parses only the newest 12; older ones are stat-only rows', async () => {
    const out = await listClaudeSessions(PROJECT);
    // Newest 12 (indices 14..3) carry a parsed title + prompt + message count.
    expect(out[0].title).toBe('Title 14');
    expect(out[0].firstUserPrompt).toBe('prompt 14');
    expect(out[0].messageCount).toBe(2);
    // The 13th+ oldest are lightweight — body never read.
    expect(out[12].title).toBeNull();
    expect(out[12].firstUserPrompt).toBeNull();
    expect(out[12].messageCount).toBe(0);
    // …but they still appear with their id + timestamps.
    expect(out[12].id).toBe('sess-02');
    expect(out[12].lastActiveAt).toBeGreaterThan(0);
  });

  it('returns [] for a project with no transcript dir', async () => {
    expect(await listClaudeSessions('/tmp/nonexistent/project')).toEqual([]);
  });
});
