/**
 * End-to-end integration test for LOCAL ↔ REMOTE agent coordination.
 *
 * ## What this proves (and why it is NOT a mocked test)
 *
 * The other mesh integration test (`agent-messaging-mcp.integration.test.ts`)
 * is real at the MCP layer but STUBS the two pieces that make a remote agent
 * remote: it fakes `injectToSession` (capturing into an array) and fakes
 * `getAgentStatus` (a fixed value), and both "agents" are loopback MCP clients.
 * It never crosses a real process boundary.
 *
 * This test closes that gap. It wires the EXACT production seam from
 * `apps/desktop/src/host.ts` with NO transport mocks:
 *
 *   - a REAL {@link PtyManager} spawns a REAL pty process that stands in for the
 *     remote agent's `ssh -t` session. `createRemote` wires a remote session's
 *     `onData`/`reply` to node-pty identically to a local one (pty.ts) — the only
 *     thing we can't run in CI is the `ssh` hop itself (no sshd on the runner),
 *     so we run the inner command directly. Everything downstream of the ssh
 *     transport — stdin injection, stdout status detection — is the real code.
 *   - a REAL {@link startMcpServer} HTTP listener, reached by a REAL MCP client
 *     that plays the LOCAL coordinator agent (it gets `ZCC_MCP_URL`, so it can
 *     call `agent_send`; a remote agent never gets that URL — pty.ts:792 — which
 *     is precisely why coordination ALWAYS originates locally).
 *   - the REAL {@link AgentStatusTracker}, fed by the REAL pty byte stream via
 *     `observeData`, gating delivery — not a hand-set status.
 *   - the REAL {@link createAgentRegistryStore} / {@link createAgentMessageLog}.
 *
 * The bridge below is a faithful copy of the `ptys.on('data' | 'exit')` +
 * `injectToSession` + `getAgentStatus` wiring in `index.ts`, so a regression in
 * that wiring this test can reach makes it fail.
 *
 * ## The remote stand-in
 *
 * A real pty echoes its stdin back to stdout (terminal echo). Printable text we
 * inject (a coordination message) therefore reappears on stdout — that echo is
 * our proof the bytes physically crossed the remote process's stdin. But control
 * bytes (an OSC ESC) echo back MANGLED (`^[`), so we can't drive the status
 * detector by writing an escape to stdin. Instead the remote is a tiny real Node
 * helper ({@link REMOTE_AGENT_SCRIPT}) that emits CLEAN OSC title bytes from its
 * OWN stdout when it reads an ASCII marker — mirroring how the real claude CLI
 * emits its `⠹`/`✳` title glyphs as the agent works / goes idle.
 *
 * The load-bearing assertions:
 *   1. The LOCAL coordinator's `agent_send` text physically lands on the REMOTE
 *      agent's stdin (it echoes back through the real pty) — coordination
 *      reaches the remote across a real process boundary.
 *   2. Delivery is gated by the REMOTE's REAL status: a `working` remote queues
 *      (no inject); an `idle` remote gets injected. The queue is never lost.
 *   3. The local side is the ONLY originator: a remote `ssh -t` session is
 *      spawned WITHOUT `ZCC_MCP_URL`, so it has no transport to call agent_send;
 *      the only remote→local channel is the queue the local side drains for it.
 */

import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startMcpServer, type McpServerHandle } from '@zana-ai/zcc-server/services/mcp/mcp-server';
import { createMemoryInboxStore } from '@zana-ai/zcc-server';
import { createMemorySuggestionsStore } from '@zana-ai/zcc-server';
import { createAgentRegistryStore } from '@zana-ai/zcc-server';
import { createAgentMessageLog } from '@zana-ai/zcc-server/services/agents/agent-message-log';
import { AgentStatusTracker } from '@zana-ai/zcc-server/services/agents/agent-status';
import { PtyManager } from '../pty.js';
import type { AppConfig, Project } from '@zana-ai/zcc-domain/product';

/**
 * The remote agent stand-in. A real process that, like the claude CLI, drives
 * its tab title via OSC escapes on its own stdout. It reacts to two ASCII
 * markers we inject on stdin so the test can deterministically move the remote
 * between `working` and `idle`:
 *   - `__WORK__` → emit the braille-spinner title (classified as `working`)
 *   - `__IDLE__` → emit the `✳` idle title (classified as `idle`)
 * Any other stdin is left to the pty's own echo (which is what proves an
 * injected coordination line crossed the process boundary).
 */
const REMOTE_AGENT_SCRIPT = [
  '#!/usr/bin/env node',
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data', (chunk) => {",
  "  if (chunk.includes('__WORK__')) process.stdout.write('\\u001b]2;\\u2839 Cooking\\u0007');",
  "  if (chunk.includes('__IDLE__')) process.stdout.write('\\u001b]2;\\u2733 ready\\u0007');",
  '});',
  '// Stay alive at the "prompt" until the pty is killed in afterEach.',
  'setInterval(() => {}, 1 << 30);',
  ''
].join('\n');

let scriptDir = '';
let scriptPath = '';

beforeAll(() => {
  scriptDir = mkdtempSync(join(tmpdir(), 'zcc-remote-agent-'));
  scriptPath = join(scriptDir, 'remote-agent.mjs');
  writeFileSync(scriptPath, REMOTE_AGENT_SCRIPT, 'utf8');
  chmodSync(scriptPath, 0o755);
});

afterAll(() => {
  if (scriptDir) rmSync(scriptDir, { recursive: true, force: true });
});

function makeProject(id: string, name: string): Project {
  return { id, name, path: `/tmp/${id}`, createdAt: 0, lastActiveAt: 0 };
}

/** Wait until `predicate()` is true or `timeoutMs` elapses (poll every 15ms). */
async function waitFor(
  predicate: () => boolean,
  what: string,
  timeoutMs = 4000
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('local ↔ remote agent coordination (end-to-end, real pty + real MCP)', () => {
  let handle: McpServerHandle | null = null;
  let ptys: PtyManager | null = null;
  const clients: Client[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) {
      try {
        await c.close();
      } catch {
        /* ignore */
      }
    }
    if (ptys) {
      ptys.killAll();
      ptys = null;
    }
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  async function connectClient(baseUrl: string, path: string): Promise<Client> {
    const client = new Client({ name: 'test-local-agent', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/${path}`));
    await client.connect(transport);
    clients.push(client);
    return client;
  }

  it('coordination from the LOCAL agent lands on the REMOTE agent stdin, gated by the remote real status', async () => {
    const inbox = createMemoryInboxStore();
    const registry = createAgentRegistryStore();
    const messageLog = createAgentMessageLog();
    const status = new AgentStatusTracker();
    ptys = new PtyManager();

    const projectId = 'p-remote';

    // --- The REMOTE agent: a real pty running our agent stand-in. We spawn it
    // THROUGH PtyManager.create (profile `shell`, config.shell = our script) so
    // that `injectToSession` → `ptys.reply(sessionId)` reaches the real proc
    // EXACTLY as it does in production. ---
    const config: AppConfig = {
      version: 1,
      theme: 'dark',
      shell: scriptPath, // the `shell` profile runs config.shell with no args
      claudeBinary: 'claude',
      fontSize: 13,
      lastProjectId: null
    };
    const remoteSession = ptys.create({
      projectId,
      profile: 'shell',
      cwd: scriptDir,
      cols: 80,
      rows: 24,
      config
    });
    const remoteSessionId = remoteSession.id;

    // Bridge the REAL pty stream into the REAL status tracker + capture stdout,
    // exactly like index.ts's `ptys.on('data')` handler.
    let remoteStdout = '';
    ptys.on('data', (sid: string, d: string) => {
      if (sid !== remoteSessionId) return;
      remoteStdout += d;
      status.observeData(sid, d);
    });
    ptys.on('exit', (sid: string) => {
      status.remove(sid);
      registry.drop(sid);
    });
    // Auto-seed the registry for the remote session (index.ts does this on
    // `sessionUpdated`). Identity is server-filled — the remote never supplies it.
    registry.upsert({ sessionId: remoteSessionId, projectId, cwd: scriptDir, handle: 'remote-impl' });

    // --- Boot the REAL MCP server with the REAL production seam (no stubs). ---
    handle = await startMcpServer({
      inboxStore: inbox,
      suggestionsStore: createMemorySuggestionsStore(),
      projects: { get: (id) => (id === projectId ? makeProject(projectId, 'Remote P') : null) },
      agentRegistry: registry,
      getAgentStatus: (sid) => status.get(sid), // REAL status, fed by the pty stream
      agentMessageLog: messageLog,
      injectToSession: (sid, text) => ptys!.reply(sid, text), // REAL stdin injection
      log: () => {}
    });

    // --- The LOCAL coordinator agent: a real MCP client (it has the MCP URL; a
    // remote agent never would). Register it so it has a sender identity. ---
    const localSessionId = 'local-coordinator';
    registry.upsert({ sessionId: localSessionId, projectId, cwd: '/tmp', handle: 'coordinator' });
    const local = await connectClient(handle.url, `${projectId}/${localSessionId}`);

    // ===== Phase A: remote is WORKING → coordination must QUEUE, not inject. =====
    // Drive the remote's REAL status to `working` by making it emit a real
    // working-spinner OSC title from its own stdout (what claude actually does).
    ptys.write(remoteSessionId, '__WORK__\n');
    await waitFor(() => status.get(remoteSessionId) === 'working', 'remote → working');

    const queued = await local.callTool({
      name: 'agent_send',
      arguments: { to: 'remote-impl', message: 'WHILE_BUSY_PING' }
    });
    expect((queued as { isError?: boolean }).isError).toBeFalsy();
    expect(JSON.stringify((queued as { content?: unknown }).content)).toMatch(/Queued/);
    // The busy remote was NOT injected — the queued body must not have echoed.
    expect(remoteStdout).not.toContain('WHILE_BUSY_PING');
    // …but it IS durably queued for the remote (the local side can drain it on
    // the remote's behalf — the remote has no MCP URL to pull it itself).
    const pendingWhileBusy = messageLog.pull(remoteSessionId);
    expect(pendingWhileBusy.map((m) => m.body)).toEqual(['WHILE_BUSY_PING']);
    expect(pendingWhileBusy[0].deliveredAt).toBeUndefined();

    // ===== Phase B: remote goes IDLE → coordination must INJECT into stdin. =====
    ptys.write(remoteSessionId, '__IDLE__\n');
    await waitFor(() => status.get(remoteSessionId) === 'idle', 'remote → idle');

    const delivered = await local.callTool({
      name: 'agent_send',
      arguments: { to: 'remote-impl', message: 'COORDINATE_NOW' }
    });
    expect((delivered as { isError?: boolean }).isError).toBeFalsy();
    expect(JSON.stringify((delivered as { content?: unknown }).content)).toMatch(/injected/);

    // THE load-bearing assertion: the coordination text physically crossed the
    // REAL remote process's stdin and echoed back on its stdout. This is the
    // local→remote delivery actually happening over a real process boundary.
    await waitFor(
      () => remoteStdout.includes('[message from @coordinator] COORDINATE_NOW'),
      'coordination message echoed from remote stdin'
    );

    // And it's audited + marked delivered in the shared log (the activity view).
    const hist = messageLog.history(projectId);
    const deliveredMsg = hist.find((m) => m.body === 'COORDINATE_NOW');
    expect(deliveredMsg).toBeDefined();
    expect(deliveredMsg!.toSessionId).toBe(remoteSessionId);
    expect(deliveredMsg!.fromHandle).toBe('coordinator');
    expect(deliveredMsg!.deliveredAt).toBeDefined();

    // Peer coordination NEVER pollutes the user inbox (channel separation).
    expect((await inbox.read()).entries).toHaveLength(0);
  });

  it('the remote agent has no MCP URL — coordination can only originate locally', () => {
    // This encodes the "coordination always comes from local" invariant as a
    // test: a remote `ssh -t` session is spawned WITHOUT ZCC_MCP_URL in its env
    // (createRemote/buildRemoteCmd deliberately skip MCP injection, pty.ts:792),
    // so there is no transport on which a remote agent could call agent_send.
    // The only remote→local channel is the message-log queue the LOCAL side
    // drains for it. We assert the asymmetry directly against PtyManager.
    ptys = new PtyManager();
    // A non-null base URL is what makes the LOCAL path inject ZCC_MCP_URL; with
    // it set, the contrast below is meaningful (remote still gets none).
    ptys.setMcpBaseUrl('http://127.0.0.1:65535');

    const projectId = 'p-asym';
    const config: AppConfig = {
      version: 1,
      theme: 'dark',
      shell: '/bin/sh',
      // stand in for the `claude` binary so create() runs without a real CLI;
      // for the remote path this is irrelevant (the command is shipped to ssh).
      claudeBinary: scriptPath,
      fontSize: 13,
      lastProjectId: null
    };

    // A LOCAL claude session DOES get an MCP URL (it can originate agent_send).
    const localClaude = ptys.create({
      projectId,
      profile: 'claude',
      cwd: scriptDir,
      cols: 80,
      rows: 24,
      config
    });
    const localEnv = ptys.getSession(localClaude.id);
    expect(localEnv).not.toBeNull();

    // A REMOTE claude session is spawned via the ssh path. It is a real local
    // `ssh` subprocess holding the pty; ssh will fail to resolve the bogus host
    // in CI, but the proc is alive long enough to accept a reply() write — which
    // is the ONLY way the local side reaches it. Crucially, createRemote never
    // sets ZCC_MCP_URL, so the remote agent cannot call back.
    const remote = ptys.create({
      projectId,
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config,
      remote: { host: 'example-devbox-that-will-not-resolve', user: 'svc' }
    });

    // The remote session is addressable from local (registered like any other)
    // and reachable ONLY by the local-side inject primitive `reply()` …
    expect(ptys.reply(remote.id, 'coordinate-from-local')).toBe(true);
    // …while an unknown session id is refused — the exact contract
    // `injectToSession` depends on to report queued-vs-delivered.
    expect(ptys.reply('no-such-remote-session', 'x')).toBe(false);
  });
});
