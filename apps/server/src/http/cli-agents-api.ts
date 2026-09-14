import type { IncomingMessage, ServerResponse } from 'node:http';
import { VALID_PROFILES } from '@zana-ai/zcc-domain/launch-provider';
import type { LaunchProfileId, TerminalSession } from '@zana-ai/zcc-domain/product';
import { readJsonBody, sendJson } from './json.js';
import type { ProductHttpContext } from './product-context.js';
import {
  asControlResult,
  cliAgentPresentationStatus,
  sessionToCliAgent,
  type ProductCliAgentCreateInput
} from './cli-agent-ops.js';

function routeParams(pathname: string, pattern: string): Record<string, string> | null {
  const pathParts = pathname.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i]!;
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(pathParts[i]!);
    } else if (part !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function controlHttpStatus(code: string | undefined): number {
  if (code === 'NOT_FOUND' || code === 'unknown-session') return 404;
  if (code === 'CANCELLED' || code === 'FORBIDDEN_AGENT') return 403;
  if (code === 'host_disconnected' || code === 'UNAVAILABLE') return 502;
  if (code === 'BAD_ARGS' || code === 'INVALID') return 400;
  return 400;
}

function sendControl(response: ServerResponse, result: { ok: true; value: unknown } | { ok: false; code: string; message: string }): boolean {
  if (result.ok) {
    sendJson(response, 200, result);
    return true;
  }
  sendJson(response, controlHttpStatus(result.code), {
    ok: false,
    code: result.code,
    message: result.message
  });
  return true;
}

function asSessionList(value: unknown): TerminalSession[] {
  if (Array.isArray(value)) return value as TerminalSession[];
  if (value && typeof value === 'object' && Array.isArray((value as { value?: unknown }).value)) {
    return (value as { value: TerminalSession[] }).value;
  }
  return [];
}

function asSession(value: unknown): TerminalSession | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as TerminalSession & { value?: unknown };
  if (typeof record.id === 'string' && typeof record.projectId === 'string') return record;
  if (record.value && typeof record.value === 'object') {
    const inner = record.value as TerminalSession;
    if (typeof inner.id === 'string' && typeof inner.projectId === 'string') return inner;
  }
  return null;
}

function statusFromControl(value: unknown): string {
  if (value && typeof value === 'object') {
    const record = value as { state?: unknown; status?: unknown; value?: { state?: unknown } };
    if (typeof record.state === 'string') return record.state;
    if (typeof record.status === 'string') return record.status;
    if (typeof record.value?.state === 'string') return record.value.state;
  }
  return 'unknown';
}

export async function handleCliAgentsApi(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext,
  path: string,
  method: string,
  requestUrl: URL
): Promise<boolean> {
  if (!path.startsWith('/api/v1/cli-agents')) return false;
  if (!ctx.cliAgentOps) {
    sendJson(response, 502, { ok: false, code: 'host_disconnected', message: 'Host is not connected' });
    return true;
  }

  if (path === '/api/v1/cli-agents' && method === 'POST') {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const projectId = typeof body.projectId === 'string' ? body.projectId : '';
    const profile = typeof body.profile === 'string' ? body.profile : '';
    if (!projectId || !profile || !VALID_PROFILES.includes(profile as LaunchProfileId)) {
      sendJson(response, 400, { ok: false, code: 'invalid-input', message: 'projectId and a valid profile are required' });
      return true;
    }
    if (!ctx.toProjects().some((row) => row.id === projectId)) {
      sendJson(response, 404, { ok: false, code: 'unknown-project', message: 'project is not registered' });
      return true;
    }
    const input: ProductCliAgentCreateInput = {
      projectId,
      profile,
      prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
      personaId: typeof body.personaId === 'string' ? body.personaId : undefined,
      extraArgs: Array.isArray(body.extraArgs)
        ? body.extraArgs.filter((item): item is string => typeof item === 'string')
        : undefined,
      harnessRouting: body.harnessRouting,
      worktree: body.worktree === true || body.worktree === false
        || (body.worktree && typeof body.worktree === 'object')
        ? body.worktree as ProductCliAgentCreateInput['worktree']
        : undefined,
      environment: typeof body.environment === 'string' ? body.environment : undefined,
      isolateScratch: typeof body.isolateScratch === 'boolean' || typeof body.isolateScratch === 'string'
        ? body.isolateScratch
        : undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
      cols: typeof body.cols === 'number' ? body.cols : 80,
      rows: typeof body.rows === 'number' ? body.rows : 24
    };
    const created = asControlResult<TerminalSession>(await ctx.cliAgentOps.create(input));
    if (!created.ok) return sendControl(response, created);
    const session = created.value;
    const status = asControlResult<{ state?: string }>(await ctx.cliAgentOps.status(session.id));
    const record = sessionToCliAgent(
      session,
      cliAgentPresentationStatus(session, status.ok ? statusFromControl(status.value) : undefined)
    );
    sendJson(response, 201, { ok: true, value: record, session: record, agent: record });
    return true;
  }

  if (path === '/api/v1/cli-agents' && method === 'GET') {
    const tag = requestUrl.searchParams.get('tag') ?? undefined;
    const listed = asControlResult<unknown>(await ctx.cliAgentOps.list());
    if (!listed.ok) return sendControl(response, listed);
    const sessions = asSessionList(listed.value);
    const records = [];
    for (const session of sessions) {
      if (tag && !(session.title ?? '').includes(tag)) continue;
      const status = asControlResult<{ state?: string }>(await ctx.cliAgentOps.status(session.id));
      records.push(sessionToCliAgent(
        session,
        cliAgentPresentationStatus(session, status.ok ? statusFromControl(status.value) : undefined)
      ));
    }
    sendJson(response, 200, { sessions: records, agents: records });
    return true;
  }

  const reply = routeParams(path, '/api/v1/cli-agents/:id/reply');
  if (reply && method === 'POST') {
    const body = (await readJsonBody(request)) as { text?: unknown };
    if (typeof body.text !== 'string' || body.text.length === 0) {
      sendJson(response, 400, { ok: false, code: 'invalid-input', message: 'text is required' });
      return true;
    }
    return sendControl(response, asControlResult(await ctx.cliAgentOps.reply(reply.id, body.text)));
  }

  const stop = routeParams(path, '/api/v1/cli-agents/:id/stop');
  if (stop && method === 'POST') {
    return sendControl(response, asControlResult(await ctx.cliAgentOps.close(stop.id)));
  }

  const one = routeParams(path, '/api/v1/cli-agents/:id');
  if (one && method === 'GET') {
    const got = asControlResult<unknown>(await ctx.cliAgentOps.get(one.id));
    if (!got.ok) {
      if (got.code === 'NOT_FOUND' || got.code === 'unknown-session') {
        sendJson(response, 404, { ok: false, code: 'NOT_FOUND', message: 'CLI agent is not live' });
        return true;
      }
      return sendControl(response, got);
    }
    const session = asSession(got.value);
    if (!session) {
      sendJson(response, 404, { ok: false, code: 'NOT_FOUND', message: 'CLI agent is not live' });
      return true;
    }
    const status = asControlResult<{ state?: string }>(await ctx.cliAgentOps.status(session.id));
    const record = sessionToCliAgent(
      session,
      cliAgentPresentationStatus(session, status.ok ? statusFromControl(status.value) : undefined)
    );
    sendJson(response, 200, { session: record, agent: record });
    return true;
  }

  return false;
}
