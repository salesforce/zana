/**
 * In-process demo control plane: stands up the real control-socket wire
 * protocol on a temp Unix socket seeded with canned agents / projects /
 * schedules, so the deck app can be exercised end-to-end with NO running Zana
 * Command Center. Shared by the terminal simulator (`zcc-deck-sim`) and the
 * hardware demo runner (`zcc-deck-demo`).
 *
 * `createDeckApp` is pointed at the returned `dataDir`; every read op is served
 * from the canned data and the mutating ops (reply / spawn / sched toggle) take
 * visible effect on the next fetch. Call `close()` to tear down the socket and
 * remove the temp dir.
 */

import { createServer, type Server } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentListItem, ProjectItem, ScheduleItem, SpawnProfileInfo } from './types.js';

const AGENTS: AgentListItem[] = [
  { sessionId: 's-1', projectId: 'p-1', handle: 'reviewer', role: 'code-review', cwd: '/tmp/a', state: 'blocked' },
  { sessionId: 's-2', projectId: 'p-1', handle: 'builder', role: 'impl', cwd: '/tmp/a', state: 'working' },
  { sessionId: 's-3', projectId: 'p-2', handle: 'scout', role: 'research', cwd: '/tmp/b', state: 'idle' }
];

const PROJECTS: ProjectItem[] = [
  { id: 'p-1', name: 'zana-command-center', path: '/tmp/a', tag: 'zcc' },
  { id: 'p-2', name: 'streamdeck-showcase', path: '/tmp/b', tag: 'deck' },
  { id: 'p-3', name: 'infra', path: '/tmp/c', tag: 'infra' }
];

const SCHEDULES: ScheduleItem[] = [
  // nightly-review fires in ~2h — exercises the "Next run" ETA readout.
  {
    id: 'sc-1',
    name: 'nightly-review',
    enabled: true,
    projectId: 'p-1',
    schedule: { every: '24h' },
    status: { nextRunAt: new Date(Date.now() + 2 * 3_600_000).toISOString() }
  },
  // hourly-sync's last run is s-2 (a live agent below), so it colours yellow.
  {
    id: 'sc-2',
    name: 'hourly-sync',
    enabled: true,
    projectId: 'p-2',
    schedule: { every: '1h' },
    status: { nextRunAt: new Date(Date.now() + 12 * 60_000).toISOString(), lastRunSessionId: 's-2' }
  }
];

// Demo the multi-provider spawn overlay: claude (+yolo) and codex enabled.
const SPAWN_PROFILES: SpawnProfileInfo[] = [
  { id: 'claude', family: 'claude', label: 'Claude', yolo: false },
  { id: 'claude-yolo', family: 'claude', label: 'Claude Yolo', yolo: true },
  { id: 'codex', family: 'codex', label: 'Codex', yolo: false }
];

export interface DemoPlane {
  /** Temp data dir holding control.sock + control.token — pass as dataDir. */
  dataDir: string;
  /** Tear down the socket and remove the temp dir. */
  close(): Promise<void>;
}

/**
 * Boot the demo plane. Returns once the socket is listening. The canned data is
 * copied per-instance so mutations (schedule toggles) don't leak across runs.
 */
export function startDemoPlane(): Promise<DemoPlane> {
  const dataDir = mkdtempSync(join(tmpdir(), 'zcc-deck-demo-'));
  const socketPath = join(dataDir, 'control.sock');
  writeFileSync(join(dataDir, 'control.token'), JSON.stringify({ token: 't', nonce: 'n', socket: socketPath }));

  // Per-instance mutable copies so toggles/spawns visibly take effect.
  const agents = AGENTS.map((a) => ({ ...a }));
  const projects = PROJECTS.map((p) => ({ ...p }));
  const schedules = SCHEDULES.map((s) => ({ ...s }));

  const server: Server = createServer((socket) => {
    socket.on('data', (buf) => {
      let req: { op: string; args?: Record<string, unknown> };
      try {
        req = JSON.parse(buf.toString('utf8').trim());
      } catch {
        socket.write(JSON.stringify({ ok: false, code: 'BAD_REQ' }) + '\n');
        return;
      }
      let value: unknown = { ok: true };
      switch (req.op) {
        case 'agent.list':
          value = agents;
          break;
        case 'project.list':
          value = projects;
          break;
        case 'sched.list':
          value = schedules;
          break;
        case 'harness.list':
          value = SPAWN_PROFILES;
          break;
        case 'status':
          value = {
            projects: projects.length,
            agents: agents.map((a) => ({ sessionId: a.sessionId, handle: a.handle, state: a.state })),
            enabledSchedules: schedules.filter((s) => s.enabled).map((s) => ({ id: s.id, name: s.name }))
          };
          break;
        case 'sched.setEnabled': {
          const s = schedules.find((x) => x.id === req.args?.id);
          if (s) s.enabled = Boolean(req.args?.enabled);
          value = s ?? { ok: false };
          break;
        }
        // term.reply / term.create / sched.runNow / agent.send just ack.
      }
      socket.write(JSON.stringify({ ok: true, value }) + '\n');
    });
  });

  return new Promise<DemoPlane>((resolve) => {
    server.listen(socketPath, () => {
      resolve({
        dataDir,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => {
              rmSync(dataDir, { recursive: true, force: true });
              res();
            });
          })
      });
    });
  });
}
