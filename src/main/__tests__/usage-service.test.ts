import { describe, it, expect } from 'vitest';
import {
  UsageService,
  toSessionEvent,
  USAGE_MAX_SESSIONS_PER_PROJECT,
  USAGE_MAX_SESSIONS_TOTAL,
  type UsageProjectRef,
  type UsageServiceDeps
} from '../usage-service.js';
import type { ClaudeSessionSummary, SessionStats } from '../../shared/types.js';
import { MAX_IDENTIFIER_LEN } from '../../shared/telemetry-events.js';

const project = (over: Partial<UsageProjectRef> = {}): UsageProjectRef => ({
  id: 'p1',
  name: 'my-project',
  path: '/repo/my-project',
  ...over
});

const summary = (over: Partial<ClaudeSessionSummary> = {}): ClaudeSessionSummary => ({
  id: 's1',
  projectPath: '/repo/my-project',
  startedAt: 1000,
  lastActiveAt: 4000,
  messageCount: 5,
  firstUserPrompt: 'fix the login bug', // <- MUST NOT leak into any event
  title: 'Login fix', // <- MUST NOT leak either
  ...over
});

const stats = (over: Partial<SessionStats> = {}): SessionStats => ({
  model: 'claude-opus-4-8',
  contextTokens: 1000,
  costUsd: 12,
  tokens: { input: 100, output: 50, cacheRead: 800, cacheWrite: 50 },
  promptCount: 4,
  toolCalls: 22,
  mcpCalls: 3,
  files: [],
  queue: [],
  ...over
});

describe('toSessionEvent', () => {
  it('builds a privacy-safe event — tokens, prompts, tool/MCP calls, duration, model, NO prompt/title/files', () => {
    const event = toSessionEvent(project(), summary(), stats(), 'reviewer');
    expect(event).toEqual({
      kind: 'usage.session',
      sessionId: 's1',
      projectId: 'p1',
      projectName: 'my-project',
      persona: 'reviewer',
      model: 'claude-opus-4-8',
      totalTokens: 100 + 50 + 800 + 50, // 1000
      promptCount: 4,
      toolCalls: 22,
      mcpCalls: 3,
      durationMs: 3000
    });
    // No cost field escapes into the event (we track activity, not dollars).
    expect(event && 'costUsd' in event).toBe(false);
    // Explicitly assert none of the transcript's content escaped.
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('fix the login bug');
    expect(serialized).not.toContain('Login fix');
  });

  it('drops a session with neither token accounting nor activity (nothing to roll up)', () => {
    expect(toSessionEvent(project(), summary(), null)).toBeNull();
    expect(
      toSessionEvent(
        project(),
        summary(),
        stats({ tokens: undefined, promptCount: undefined, toolCalls: undefined, mcpCalls: undefined })
      )
    ).toBeNull();
  });

  it('keeps a session with tokens but an unknown model', () => {
    const event = toSessionEvent(
      project(),
      summary(),
      stats({ model: undefined, tokens: { input: 500, output: 200, cacheRead: 0, cacheWrite: 0 } })
    );
    expect(event?.model).toBeUndefined();
    expect(event?.totalTokens).toBe(700);
  });

  it('omits a zero/negative duration rather than emitting durationMs: 0', () => {
    const event = toSessionEvent(project(), summary({ startedAt: 5000, lastActiveAt: 5000 }), stats());
    expect(event?.durationMs).toBeUndefined();
  });

  it('clamps a pathologically long project name to an identifier (never fails the guard)', () => {
    const longName = 'x'.repeat(MAX_IDENTIFIER_LEN + 50);
    const event = toSessionEvent(project({ name: longName }), summary(), stats());
    expect(event?.projectName.length).toBe(MAX_IDENTIFIER_LEN);
  });
});

// A deterministic in-memory deps builder — no fs, no Electron, no spawn.
function makeDeps(
  projects: UsageProjectRef[],
  sessionsByPath: Record<string, ClaudeSessionSummary[]>,
  statsById: Record<string, SessionStats | null>,
  extra: Partial<UsageServiceDeps> = {}
): UsageServiceDeps {
  return {
    listProjects: () => projects,
    listSessions: async (path) => sessionsByPath[path] ?? [],
    readStats: async (_path, id) => statsById[id] ?? null,
    ...extra
  };
}

describe('UsageService.summarize', () => {
  it('aggregates across projects into a privacy-safe summary with a fixed clock', async () => {
    const deps = makeDeps(
      [project({ id: 'p1', name: 'alpha', path: '/a' }), project({ id: 'p2', name: 'beta', path: '/b' })],
      {
        '/a': [summary({ id: 'a1', projectPath: '/a' }), summary({ id: 'a2', projectPath: '/a' })],
        '/b': [summary({ id: 'b1', projectPath: '/b' })]
      },
      {
        a1: stats({ tokens: { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 }, model: 'claude-opus-4-8' }),
        a2: stats({ tokens: { input: 400, output: 0, cacheRead: 0, cacheWrite: 0 }, model: 'claude-sonnet-4-5' }),
        b1: stats({ tokens: { input: 600, output: 0, cacheRead: 0, cacheWrite: 0 }, model: 'claude-opus-4-8' })
      }
    );
    const svc = new UsageService(deps, () => 999);
    const result = await svc.summarize();

    expect(result.generatedAt).toBe(999);
    expect(result.sessionCount).toBe(3);
    expect(result.totalTokens).toBe(2000);
    expect(result.byProject.map((b) => b.label)).toEqual(['alpha', 'beta']);
    // ranked by tokens desc: a1 (1000), b1 (600), a2 (400)
    expect(result.topSessions.map((e) => e.sessionId)).toEqual(['a1', 'b1', 'a2']);
  });

  it('skips a project whose session listing throws, without failing the summary', async () => {
    const deps: UsageServiceDeps = {
      listProjects: () => [project({ id: 'bad', path: '/bad' }), project({ id: 'ok', name: 'ok', path: '/ok' })],
      listSessions: async (path) => {
        if (path === '/bad') throw new Error('EACCES');
        return [summary({ id: 'ok1', projectPath: '/ok' })];
      },
      readStats: async (_p, _id) => stats({ costUsd: 3 })
    };
    const result = await new UsageService(deps, () => 0).summarize();
    expect(result.sessionCount).toBe(1);
    expect(result.topSessions[0]?.sessionId).toBe('ok1');
  });

  it('skips a session whose stats read throws', async () => {
    const deps: UsageServiceDeps = {
      listProjects: () => [project({ path: '/a' })],
      listSessions: async () => [summary({ id: 'good' }), summary({ id: 'boom' })],
      readStats: async (_p, id) => {
        if (id === 'boom') throw new Error('read fail');
        return stats({ costUsd: 5 });
      }
    };
    const result = await new UsageService(deps, () => 0).summarize();
    expect(result.sessionCount).toBe(1);
    expect(result.topSessions[0]?.sessionId).toBe('good');
  });

  it('attaches a persona from personaFor when available', async () => {
    const deps = makeDeps([project({ path: '/a' })], { '/a': [summary({ id: 's1' })] }, { s1: stats() }, {
      personaFor: (id) => (id === 's1' ? 'architect' : undefined)
    });
    const result = await new UsageService(deps, () => 0).summarize();
    expect(result.topSessions[0]?.persona).toBe('architect');
  });

  it('bounds the per-project read to USAGE_MAX_SESSIONS_PER_PROJECT', async () => {
    const many = Array.from({ length: USAGE_MAX_SESSIONS_PER_PROJECT + 10 }, (_, i) =>
      summary({ id: `s${i}`, projectPath: '/a' })
    );
    let reads = 0;
    const deps: UsageServiceDeps = {
      listProjects: () => [project({ path: '/a' })],
      listSessions: async () => many,
      readStats: async () => {
        reads++;
        return stats({ costUsd: 1 });
      }
    };
    const result = await new UsageService(deps, () => 0).summarize();
    expect(reads).toBe(USAGE_MAX_SESSIONS_PER_PROJECT);
    expect(result.sessionCount).toBe(USAGE_MAX_SESSIONS_PER_PROJECT);
  });

  it('bounds total transcripts read across projects to USAGE_MAX_SESSIONS_TOTAL', async () => {
    // Enough projects × sessions to blow past the global cap.
    const projs = Array.from({ length: 30 }, (_, i) => project({ id: `p${i}`, name: `p${i}`, path: `/p${i}` }));
    const sessionsByPath: Record<string, ClaudeSessionSummary[]> = {};
    for (const p of projs) {
      sessionsByPath[p.path] = Array.from({ length: USAGE_MAX_SESSIONS_PER_PROJECT }, (_, j) =>
        summary({ id: `${p.id}-s${j}`, projectPath: p.path })
      );
    }
    let reads = 0;
    const deps: UsageServiceDeps = {
      listProjects: () => projs,
      listSessions: async (path) => sessionsByPath[path] ?? [],
      readStats: async () => {
        reads++;
        return stats({ costUsd: 1 });
      }
    };
    await new UsageService(deps, () => 0).summarize();
    expect(reads).toBe(USAGE_MAX_SESSIONS_TOTAL);
  });
});
