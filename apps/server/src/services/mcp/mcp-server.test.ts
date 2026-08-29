import { describe, it, expect } from 'vitest';
import {
  matchMcpRoute,
  matchNotifyHookRoute,
  matchFirstPromptHookRoute,
  matchQuestionHookRoute,
  matchSubagentHookRoute,
  matchToolActivityHookRoute,
  matchOverseerHookRoute,
  extractPromptFromHookBody,
  extractSubagentIdentity
} from './mcp-server.js';

describe('matchMcpRoute', () => {
  it('matches the project-scoped route', () => {
    expect(matchMcpRoute('/mcp/proj-1')).toEqual({
      projectId: 'proj-1'
    });
  });

  it('matches the session-scoped route', () => {
    expect(matchMcpRoute('/mcp/proj-1/sess-A')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A'
    });
  });

  it('ignores query strings when matching', () => {
    expect(matchMcpRoute('/mcp/proj-1/sess-A?foo=bar')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A'
    });
  });

  it('url-decodes captured segments', () => {
    expect(matchMcpRoute('/mcp/proj%2F1/sess%20A')).toEqual({
      projectId: 'proj/1',
      sessionId: 'sess A'
    });
  });

  it('rejects extra path segments', () => {
    expect(matchMcpRoute('/mcp/proj-1/sess-A/credential/extra')).toBeNull();
  });

  it('matches a credential-bound session route', () => {
    expect(matchMcpRoute('/mcp/proj-1/sess-A/credential')).toEqual({
      projectId: 'proj-1', sessionId: 'sess-A', sessionCredential: 'credential'
    });
  });

  it('rejects a bare /mcp with no project', () => {
    expect(matchMcpRoute('/mcp')).toBeNull();
    expect(matchMcpRoute('/mcp/')).toBeNull();
  });

  it('rejects unrelated paths and undefined input', () => {
    expect(matchMcpRoute('/health')).toBeNull();
    expect(matchMcpRoute(undefined)).toBeNull();
  });

  // Regression (QA high-sev #2): a malformed percent-escape makes
  // decodeURIComponent throw a URIError. Before the safeDecode fix this
  // propagated uncaught out of the matcher and crashed the request handler
  // (a cheap DoS). The matcher must now treat it as an unmatched route (null).
  it('returns null on malformed percent-encoding instead of throwing', () => {
    expect(() => matchMcpRoute('/mcp/%FF')).not.toThrow();
    expect(matchMcpRoute('/mcp/%FF')).toBeNull();
    expect(matchMcpRoute('/mcp/proj-1/%E0%A4%A')).toBeNull(); // truncated sequence
    expect(matchMcpRoute('/mcp/%')).toBeNull(); // lone percent
  });
});

describe('route matchers reject malformed percent-encoding (no throw)', () => {
  // Same URIError DoS surface across every hook matcher that decodes a segment.
  it('matchNotifyHookRoute', () => {
    expect(() => matchNotifyHookRoute('/hook/notify/%FF/s/blocked')).not.toThrow();
    expect(matchNotifyHookRoute('/hook/notify/%FF/s/blocked')).toBeNull();
  });
  it('matchOverseerHookRoute', () => {
    expect(() => matchOverseerHookRoute('/hook/overseer/%FF/s')).not.toThrow();
    expect(matchOverseerHookRoute('/hook/overseer/%FF/s')).toBeNull();
  });
  it('matchSubagentHookRoute', () => {
    expect(() => matchSubagentHookRoute('/hook/subagent/%FF/s/start')).not.toThrow();
    expect(matchSubagentHookRoute('/hook/subagent/%FF/s/start')).toBeNull();
  });
  it('matchToolActivityHookRoute', () => {
    expect(() => matchToolActivityHookRoute('/hook/toolactivity/%FF/s/start')).not.toThrow();
    expect(matchToolActivityHookRoute('/hook/toolactivity/%FF/s/start')).toBeNull();
  });
  it('matchFirstPromptHookRoute', () => {
    expect(() => matchFirstPromptHookRoute('/hook/firstprompt/p/%FF')).not.toThrow();
    expect(matchFirstPromptHookRoute('/hook/firstprompt/p/%FF')).toBeNull();
  });
  it('matchQuestionHookRoute', () => {
    expect(() => matchQuestionHookRoute('/hook/question/p/%FF')).not.toThrow();
    expect(matchQuestionHookRoute('/hook/question/p/%FF')).toBeNull();
  });
});

describe('matchQuestionHookRoute', () => {
  it('matches the question route', () => {
    expect(matchQuestionHookRoute('/hook/question/proj-1/sess-A')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A'
    });
  });

  it('url-decodes captured ids and ignores query strings', () => {
    expect(matchQuestionHookRoute('/hook/question/proj%2F1/sess%20A?x=1')).toEqual({
      projectId: 'proj/1',
      sessionId: 'sess A'
    });
  });

  it('rejects malformed paths and the other hook routes', () => {
    expect(matchQuestionHookRoute('/hook/question/onlyone')).toBeNull();
    expect(matchQuestionHookRoute('/hook/question/proj-1')).toBeNull();
    expect(matchQuestionHookRoute('/hook/question/proj-1/sess-A/extra')).toBeNull();
    expect(matchQuestionHookRoute('/hook/question/proj-1/sess-A/')).toBeNull();
    expect(matchQuestionHookRoute('/hook/firstprompt/proj-1/sess-A')).toBeNull();
    expect(matchQuestionHookRoute('/hook/notify/proj-1/sess-A/blocked')).toBeNull();
    expect(matchQuestionHookRoute(undefined)).toBeNull();
  });
});

describe('matchNotifyHookRoute', () => {
  it('matches the blocked action', () => {
    expect(matchNotifyHookRoute('/hook/notify/proj-1/sess-A/blocked')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A',
      action: 'blocked'
    });
  });

  it('matches the unblocked action', () => {
    expect(matchNotifyHookRoute('/hook/notify/proj-1/sess-A/unblocked')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A',
      action: 'unblocked'
    });
  });

  it('url-decodes captured ids and ignores query strings', () => {
    expect(matchNotifyHookRoute('/hook/notify/proj%2F1/sess%20A/blocked?x=1')).toEqual({
      projectId: 'proj/1',
      sessionId: 'sess A',
      action: 'blocked'
    });
  });

  it('rejects unknown actions and malformed paths', () => {
    expect(matchNotifyHookRoute('/hook/notify/proj-1/sess-A/paused')).toBeNull();
    expect(matchNotifyHookRoute('/hook/notify/proj-1/sess-A')).toBeNull();
    expect(matchNotifyHookRoute('/hook/notify/proj-1/sess-A/blocked/extra')).toBeNull();
    expect(matchNotifyHookRoute('/hook/stop/proj-1/sess-A')).toBeNull();
    expect(matchNotifyHookRoute(undefined)).toBeNull();
  });
});

describe('matchOverseerHookRoute', () => {
  it('matches the overseer route', () => {
    expect(matchOverseerHookRoute('/hook/overseer/proj-1/sess-A')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A'
    });
  });

  it('url-decodes captured ids and ignores query strings', () => {
    expect(matchOverseerHookRoute('/hook/overseer/proj%2F1/sess%20A?x=1')).toEqual({
      projectId: 'proj/1',
      sessionId: 'sess A'
    });
  });

  it('rejects malformed paths and undefined input', () => {
    expect(matchOverseerHookRoute('/hook/overseer/proj-1')).toBeNull();
    expect(matchOverseerHookRoute('/hook/overseer/proj-1/sess-A/extra')).toBeNull();
    expect(matchOverseerHookRoute('/hook/notify/proj-1/sess-A')).toBeNull();
    expect(matchOverseerHookRoute(undefined)).toBeNull();
  });
});

describe('matchFirstPromptHookRoute', () => {
  it('matches the firstprompt route', () => {
    expect(matchFirstPromptHookRoute('/hook/firstprompt/proj-1/sess-A')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A'
    });
  });

  it('url-decodes captured ids and ignores query strings', () => {
    expect(matchFirstPromptHookRoute('/hook/firstprompt/proj%2F1/sess%20A?x=1')).toEqual({
      projectId: 'proj/1',
      sessionId: 'sess A'
    });
  });

  it('rejects malformed paths and the other hook routes', () => {
    expect(matchFirstPromptHookRoute('/hook/firstprompt/proj-1')).toBeNull();
    expect(matchFirstPromptHookRoute('/hook/firstprompt/proj-1/sess-A/extra')).toBeNull();
    expect(matchFirstPromptHookRoute('/hook/notify/proj-1/sess-A/blocked')).toBeNull();
    expect(matchFirstPromptHookRoute(undefined)).toBeNull();
  });
});

describe('matchSubagentHookRoute', () => {
  it('matches the start action', () => {
    expect(matchSubagentHookRoute('/hook/subagent/proj-1/sess-A/start')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A',
      action: 'start'
    });
  });

  it('matches the stop action', () => {
    expect(matchSubagentHookRoute('/hook/subagent/proj-1/sess-A/stop')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A',
      action: 'stop'
    });
  });

  it('url-decodes captured ids and ignores query strings', () => {
    expect(matchSubagentHookRoute('/hook/subagent/proj%2F1/sess%20A/start?x=1')).toEqual({
      projectId: 'proj/1',
      sessionId: 'sess A',
      action: 'start'
    });
  });

  it('rejects unknown actions and malformed paths', () => {
    expect(matchSubagentHookRoute('/hook/subagent/proj-1/sess-A/pause')).toBeNull();
    expect(matchSubagentHookRoute('/hook/subagent/proj-1/sess-A')).toBeNull();
    expect(matchSubagentHookRoute('/hook/subagent/proj-1/sess-A/start/extra')).toBeNull();
    expect(matchSubagentHookRoute('/hook/notify/proj-1/sess-A/blocked')).toBeNull();
    expect(matchSubagentHookRoute(undefined)).toBeNull();
  });
});

describe('matchToolActivityHookRoute', () => {
  it('matches the start action', () => {
    expect(matchToolActivityHookRoute('/hook/toolactivity/proj-1/sess-A/start')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A',
      action: 'start'
    });
  });

  it('matches the stop action', () => {
    expect(matchToolActivityHookRoute('/hook/toolactivity/proj-1/sess-A/stop')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A',
      action: 'stop'
    });
  });

  it('matches the clear action', () => {
    expect(matchToolActivityHookRoute('/hook/toolactivity/proj-1/sess-A/clear')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A',
      action: 'clear'
    });
  });

  it('url-decodes captured ids and ignores query strings', () => {
    expect(matchToolActivityHookRoute('/hook/toolactivity/proj%2F1/sess%20A/start?x=1')).toEqual({
      projectId: 'proj/1',
      sessionId: 'sess A',
      action: 'start'
    });
  });

  it('rejects unknown actions and malformed paths', () => {
    expect(matchToolActivityHookRoute('/hook/toolactivity/proj-1/sess-A/pause')).toBeNull();
    expect(matchToolActivityHookRoute('/hook/toolactivity/proj-1/sess-A')).toBeNull();
    expect(matchToolActivityHookRoute('/hook/toolactivity/proj-1/sess-A/start/extra')).toBeNull();
    expect(matchToolActivityHookRoute('/hook/subagent/proj-1/sess-A/start')).toBeNull();
    expect(matchToolActivityHookRoute(undefined)).toBeNull();
  });
});

describe('extractSubagentIdentity', () => {
  it('pulls description + subagent_type from a PreToolUse(Task) payload', () => {
    const body = JSON.stringify({
      tool_name: 'Task',
      tool_input: {
        description: 'Review the auth diff',
        subagent_type: 'code-reviewer',
        prompt: 'long prompt text…'
      },
      session_id: 'abc'
    });
    expect(extractSubagentIdentity(body)).toEqual({
      description: 'Review the auth diff',
      subagentType: 'code-reviewer'
    });
  });

  it('returns empty object when tool_input is missing', () => {
    expect(extractSubagentIdentity(JSON.stringify({ tool_name: 'Task' }))).toEqual({});
  });

  it('returns empty object for non-JSON body (count still increments upstream)', () => {
    expect(extractSubagentIdentity('not json at all')).toEqual({});
    expect(extractSubagentIdentity('')).toEqual({});
  });

  it('ignores non-string fields', () => {
    const body = JSON.stringify({ tool_input: { description: 42, subagent_type: null } });
    expect(extractSubagentIdentity(body)).toEqual({});
  });

  it('truncates over-long fields', () => {
    const long = 'x'.repeat(5000);
    const body = JSON.stringify({ tool_input: { description: long, subagent_type: 'researcher' } });
    const out = extractSubagentIdentity(body);
    expect(out.description?.length).toBe(2000);
    expect(out.subagentType).toBe('researcher');
  });
});

describe('extractPromptFromHookBody', () => {
  it('pulls the prompt field out of a UserPromptSubmit JSON payload', () => {
    const body = JSON.stringify({
      session_id: 'abc',
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Fix the login redirect bug'
    });
    expect(extractPromptFromHookBody(body)).toBe('Fix the login redirect bug');
  });

  it('uses the raw body only when it is not JSON at all', () => {
    expect(extractPromptFromHookBody('just some text')).toBe('just some text');
  });

  it('returns empty for valid JSON without a string prompt (no raw-event leak)', () => {
    // Must NOT forward the whole event blob to the model — that would yield a
    // garbage label. An unexpected JSON shape resolves to no title.
    expect(extractPromptFromHookBody('{"no_prompt":true}')).toBe('');
    expect(extractPromptFromHookBody('{"prompt":123}')).toBe('');
    expect(extractPromptFromHookBody('{"session_id":"abc","cwd":"/x"}')).toBe('');
  });

  it('returns empty for an empty body', () => {
    expect(extractPromptFromHookBody('')).toBe('');
    expect(extractPromptFromHookBody('   ')).toBe('');
  });

  it('caps an enormous prompt', () => {
    const huge = JSON.stringify({ prompt: 'x'.repeat(20_000) });
    expect(extractPromptFromHookBody(huge).length).toBe(8_000);
  });
});
