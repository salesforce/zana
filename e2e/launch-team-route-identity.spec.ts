/**
 * launch_team ROUTE IDENTITY at the real Electron boundary — the item-2 seam.
 *
 * `launch_team` (the agent-callable team-launch MCP tool) is reachable two ways,
 * which differ ONLY in how Electron-main proves the caller's identity at the
 * loopback MCP route `/mcp/:projectId/:sessionId/:credential`:
 *   - CLI Agent  → the caller is a LIVE PTY SESSION (validateLaunchRouteIdentity
 *                  pty branch → ptys.getSession).
 *   - Modern/ACP → the caller is a LIVE CONVERSATION THREAD, no pty
 *                  (validateLaunchRouteIdentity ACP branch → a cross-process
 *                  runtimeSupervisor.isThreadLive probe into the server-runtime).
 * Everything downstream (the authorize→launch handshake, cohort spawn, the DAG
 * engine) is shared and already covered by job-team-run.spec.ts. THIS spec pins
 * the identity gate alone, at the production boundary, for BOTH surfaces plus the
 * defensive rejection: a valid credential for a session/thread that is NOT live
 * must still be refused (a credential proves "trusted local process", never
 * liveness).
 *
 * We drive the route DIRECTLY (a stateless streamable-http `tools/call` POST, the
 * same shape the fake cohort binary uses) and assert on `authorize_team_launch`,
 * which runs the identical route-identity gate as `launch_team` but issues only
 * authorization capabilities — no cohort is spawned, so the assertion is about
 * identity, not the engine.
 *
 * `teamLaunchEnabled` gates whether `launchTeam`/`authorizeTeamLaunch` are wired
 * onto the MCP route AT BOOT (host.ts startMcpServer opts). A post-boot
 * config.set is too late, so it is seeded via initialConfig.
 */
import { test, expect } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({ e2e: true, initialConfig: { teamLaunchEnabled: true } });

test.setTimeout(90_000);

interface RpcToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/** Parse a stateless streamable-http reply — bare JSON or an SSE `data:` frame. */
function parseRpc(bodyText: string): { result?: RpcToolResult; error?: unknown } {
  const trimmed = bodyText.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const dataLines = trimmed
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .filter((line) => line.length > 0);
  if (dataLines.length === 0) throw new Error(`unparseable MCP reply: ${bodyText.slice(0, 200)}`);
  return JSON.parse(dataLines[dataLines.length - 1]);
}

async function toolCall(route: string, name: string, args: Record<string, unknown>): Promise<RpcToolResult> {
  const response = await fetch(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  });
  const rpc = parseRpc(await response.text());
  if (rpc.error) throw new Error(`tools/call ${name} rpc error: ${JSON.stringify(rpc.error)}`);
  if (!rpc.result) throw new Error(`tools/call ${name} returned no result`);
  return rpc.result;
}

function resultText(result: RpcToolResult): string {
  return result.content?.find((c) => c.type === 'text')?.text ?? '';
}

test('launch_team route honors a live pty session AND a live Modern thread, rejects a dead identity', async ({
  app
}) => {
  const { window, home } = app;
  const agent = makeFakeAgentBinary(); // claude/working-hold → the pty stays alive.
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-launch-team-route-'));
  let projectId: string | null = null;
  let sessionId: string | null = null;
  let threadId: string | null = null;

  try {
    await window.evaluate((bin) => window.cc.config.set({
      teamLaunchEnabled: true,
      sponsorPromptDismissed: true,
      claudeBinary: bin,
      defaultHarness: 'claude'
    }), agent.path);

    // A worker persona + a single-worker team (no orchestrator) so authorize's
    // host-expanded slot count is exactly 1 — a valid team, so any rejection can
    // only be the identity gate, never team-not-found.
    await window.evaluate(() => window.cc.personas.save({
      id: 'e2e-launch-worker',
      name: 'E2E Launch Worker',
      description: 'Worker persona for the launch_team route identity spec',
      baseProfile: 'claude',
      permissionMode: 'default',
      systemPrompt: ''
    }));
    await window.evaluate(() => window.cc.teams.save({
      id: 'e2e-launch-team',
      name: 'E2E Launch Route Team',
      description: 'Single-worker team for route identity assertions',
      slots: [{ personaId: 'e2e-launch-worker', quantity: 1 }]
    }));

    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string };
      return proj.id;
    }, projectDir);
    expect(projectId).toBeTruthy();

    // A live pty agent → its session id is the CLI-Agent route identity. Spawning
    // it also lazily mints the control-signing key we read below.
    sessionId = await window.evaluate(async (pid) => {
      const res = await window.cc.terminals.create({ projectId: pid, profile: 'claude', cols: 80, rows: 24, title: 'Launch Route Probe' });
      if (!res || !('ok' in res) || !res.ok) throw new Error('terminals.create failed: ' + JSON.stringify(res));
      return res.value.id;
    }, projectId);
    expect(sessionId).toBeTruthy();

    // Discover the loopback MCP base URL (port file) + the control-signing key,
    // then mint a route credential exactly as pty.ts / the ACP forwarder do:
    // credential = HMAC-SHA256(key, <session-or-thread-id>).
    const { port } = JSON.parse(readFileSync(join(home, 'electron-user-data', 'mcp-port-dev.json'), 'utf8')) as { port: number };
    const signingKey = readFileSync(join(home, '.zcc', 'control-signing.key'));
    const credentialFor = (id: string): string => createHmac('sha256', signingKey).update(id, 'utf8').digest('hex');
    const routeFor = (id: string): string =>
      `http://127.0.0.1:${port}/mcp/${encodeURIComponent(projectId!)}/${encodeURIComponent(id)}/${encodeURIComponent(credentialFor(id))}`;

    const authorizeArgs = (id: string) => ({
      teamId: 'e2e-launch-team',
      launchRequestId: `req-${id}`,
      slots: [{ initialTask: 'probe route identity' }]
    });

    const expectAuthorized = (result: RpcToolResult) => {
      expect(result.isError).toBeFalsy();
      const value = JSON.parse(resultText(result)) as { slots: Array<{ slotId: string; authorizationId: string }> };
      expect(value.slots).toHaveLength(1);
      expect(value.slots[0].authorizationId).toBeTruthy();
      expect(value.slots[0].slotId).toBeTruthy();
    };

    // Phase A — CLI Agent: a live pty session is accepted.
    expectAuthorized(await toolCall(routeFor(sessionId!), 'authorize_team_launch', authorizeArgs(sessionId!)));

    // Phase B — Modern/ACP: a live conversation thread (no pty) is accepted via
    // the cross-process isThreadLive probe. Create it through the real boundary.
    threadId = await window.evaluate(async (pid) => {
      const res = await fetch('/api/v1/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: pid, input: 'launch route identity probe' })
      });
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error('POST /threads failed: ' + JSON.stringify(body));
      return body.value.id as string;
    }, projectId);
    expect(threadId).toBeTruthy();

    // The thread flips starting→active after host start; either is "live". Give
    // it a beat, then assert the route accepts the thread identity.
    await expect.poll(async () => {
      const result = await toolCall(routeFor(threadId!), 'authorize_team_launch', authorizeArgs(threadId!));
      return result.isError ? resultText(result) : 'authorized';
    }, { timeout: 30_000, intervals: [1000] }).toBe('authorized');

    // Phase C — defense: a VALID credential minted for an id that is neither a
    // live pty session nor a live thread must still be refused. Proves the
    // liveness gate, not just the credential, authorizes a launch.
    const deadId = randomUUID();
    const dead = await toolCall(routeFor(deadId), 'authorize_team_launch', authorizeArgs(deadId));
    expect(dead.isError).toBe(true);
    expect(resultText(dead)).toContain('not live in this project');
  } finally {
    try {
      if (projectId) {
        await window.evaluate(async (pid) => {
          try {
            const sessions = (await window.cc.terminals.list?.(pid)) as Array<{ id: string }> | undefined;
            if (Array.isArray(sessions)) {
              for (const s of sessions) { try { await window.cc.terminals.close(s.id); } catch { /* best-effort */ } }
            }
          } catch { /* best-effort */ }
          try { await window.cc.projects.remove(pid); } catch { /* best-effort */ }
        }, projectId);
      }
    } catch { /* page may already be closed on timeout */ }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    agent.cleanup();
  }
});
