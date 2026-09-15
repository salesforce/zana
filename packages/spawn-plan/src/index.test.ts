import { describe, it, expect } from 'vitest';
import { buildSystemPromptGuidance, extraArgsPinSession, extractPinnedSessionId, inboxAllowedTools } from './index.js';

// Distinctive per-block markers (a tool id unique to each guidance block).
const MESH = 'register_agent';
const SCHEDULE = 'schedule_report';
const AWARENESS = 'list_projects';
const LIBRARY = 'library_write';
const FOLLOWUP = 'followup_create';

describe('extractPinnedSessionId / extraArgsPinSession', () => {
  it('extracts UUID from --session as well as --resume / --session-id', () => {
    expect(extractPinnedSessionId(['--session', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']))
      .toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(extractPinnedSessionId(['--resume', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']))
      .toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(extractPinnedSessionId(['--session', 'ses_not_uuid'])).toBeUndefined();
  });

  it('treats resume/continue/session flags as pinning', () => {
    expect(extraArgsPinSession(['--continue'])).toBe(true);
    expect(extraArgsPinSession(['--session-id', 'x'])).toBe(true);
    expect(extraArgsPinSession(['--session', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'])).toBe(true);
    expect(extraArgsPinSession(['--model', 'opus'])).toBe(false);
    expect(extraArgsPinSession(undefined)).toBe(false);
  });
});

describe('buildSystemPromptGuidance', () => {
  it('non-scheduled interactive: mesh + awareness + library + followup present, schedule absent', () => {
    const g = buildSystemPromptGuidance(false);
    expect(g).toContain(MESH);
    expect(g).toContain(AWARENESS);
    expect(g).toContain(LIBRARY);
    expect(g).toContain(FOLLOWUP);
    expect(g).not.toContain(SCHEDULE);
  });

  it('scheduled adds the run-report block', () => {
    expect(buildSystemPromptGuidance(true)).toContain(SCHEDULE);
  });

  it('job-team coordination omits the agent-mesh block but keeps the rest', () => {
    const g = buildSystemPromptGuidance(false, 'job-team');
    expect(g).not.toContain(MESH);
    expect(g).toContain(AWARENESS);
    expect(g).toContain(LIBRARY);
    expect(g).toContain(FOLLOWUP);
  });

  it('non-job-team coordination modes keep the mesh block', () => {
    expect(buildSystemPromptGuidance(false, 'interactive-team')).toContain(MESH);
    expect(buildSystemPromptGuidance(false, 'autonomous-team')).toContain(MESH);
  });

  it('scheduled + job-team: schedule present, mesh absent', () => {
    const g = buildSystemPromptGuidance(true, 'job-team');
    expect(g).toContain(SCHEDULE);
    expect(g).not.toContain(MESH);
  });

  it('blocks are blank-line separated and inbox guidance leads', () => {
    const g = buildSystemPromptGuidance(false);
    expect(g).toContain('\n\n');
    const inboxAt = g.indexOf('inbox_push');
    expect(inboxAt).toBeGreaterThanOrEqual(0);
    expect(inboxAt).toBeLessThan(g.indexOf(AWARENESS));
  });
});

describe('inboxAllowedTools', () => {
  it('omits run_in_terminal unless the experiment is on', () => {
    expect(inboxAllowedTools(false)).not.toContain('mcp__zcc-inbox__run_in_terminal');
    expect(inboxAllowedTools(true)).not.toContain('mcp__zcc-inbox__run_in_terminal');
    expect(inboxAllowedTools(false, { runInTerminal: true })).toContain('mcp__zcc-inbox__run_in_terminal');
  });

  it('does not pre-approve the retired inbox_ask tool', () => {
    expect(inboxAllowedTools(false)).not.toContain('mcp__zcc-inbox__inbox_ask');
    expect(inboxAllowedTools(true)).not.toContain('mcp__zcc-inbox__inbox_ask');
    expect(buildSystemPromptGuidance(false)).not.toContain('inbox_ask');
  });
});
