/**
 * End-to-end-ish test against a FakeDeck and a real Unix-domain control socket
 * that echoes canned responses. Proves the full path from the ZCC hub: press
 * the hub icon → menu, press Agents → poll renders the grid, press a tile →
 * open overlay, press Approve → a `term.reply` intent reaches the control plane
 * with the right args.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDeckApp } from '../app.js';
import { FakeDeck } from '../deck/fake-device.js';
import { coordToIndex } from '../deck/device.js';
import type { AgentListItem, ProjectItem, ScheduleItem, SpawnProfileInfo } from '../lib/types.js';

let server: Server | null = null;
const dirs: string[] = [];

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.useRealTimers();
});

function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'zcc-deck-'));
  dirs.push(d);
  return d;
}

interface Recorded {
  op: string;
  args: Record<string, unknown>;
}

interface Fixtures {
  agents?: AgentListItem[];
  projects?: ProjectItem[];
  schedules?: ScheduleItem[];
  profiles?: SpawnProfileInfo[];
}

/**
 * Stand up a control socket that answers the read ops from `fixtures` and
 * records every op it receives (so tests can assert the mutating ones).
 */
async function startControlPlane(dataDir: string, fixtures: Fixtures = {}): Promise<Recorded[]> {
  const recorded: Recorded[] = [];
  const socketPath = join(dataDir, 'control.sock');
  writeFileSync(
    join(dataDir, 'control.token'),
    JSON.stringify({ token: 't', nonce: 'n', socket: socketPath })
  );

  const agents = fixtures.agents ?? [];
  server = createServer((socket) => {
    socket.on('data', (buf) => {
      const req = JSON.parse(buf.toString('utf8').trim());
      recorded.push({ op: req.op, args: req.args });
      let value: unknown = { ok: true };
      if (req.op === 'agent.list') value = agents;
      else if (req.op === 'project.list') value = fixtures.projects ?? [];
      else if (req.op === 'harness.list') value = fixtures.profiles ?? [];
      else if (req.op === 'sched.list') value = fixtures.schedules ?? [];
      else if (req.op === 'status') {
        value = {
          projects: (fixtures.projects ?? []).length,
          agents: agents.map((a) => ({ sessionId: a.sessionId, handle: a.handle, state: a.state })),
          enabledSchedules: (fixtures.schedules ?? []).filter((s) => s.enabled).map((s) => ({ id: s.id, name: s.name }))
        };
      }
      socket.write(JSON.stringify({ ok: true, value }) + '\n');
    });
  });
  await new Promise<void>((r) => server!.listen(socketPath, r));
  return recorded;
}

const AGENT: AgentListItem = {
  sessionId: 's-1',
  projectId: 'p-1',
  handle: 'reviewer',
  role: 'code-review',
  cwd: '/tmp/proj',
  state: 'blocked'
};

const PROJECT: ProjectItem = { id: 'p-1', name: 'demo', path: '/tmp/proj', tag: 'demo' };

const SCHEDULE: ScheduleItem = {
  id: 'sc-1',
  name: 'nightly',
  enabled: true,
  projectId: 'p-1',
  schedule: { every: '24h' }
};

describe('deck app — ZCC hub', () => {
  it('opens the hub → Agents, renders the grid, and sends a reply intent', async () => {
    const dataDir = freshDir();
    const recorded = await startControlPlane(dataDir, { agents: [AGENT] });

    const deck = new FakeDeck();
    const app = createDeckApp(deck, { dataDir, pollIntervalMs: 10_000 });
    await app.start();

    // Root is the landing page: ZCC hub tile at (0,0). Press → menu.
    deck.press(coordToIndex(0, 0));
    // Menu: Agents tile at (0,0). Press → agents view (starts polling).
    deck.press(coordToIndex(0, 0));

    await vi.waitFor(() => expect(recorded.some((r) => r.op === 'agent.list')).toBe(true));

    // Agent sits in slot 0 → key index 0. Press it to open the overlay.
    deck.press(coordToIndex(0, 0));
    // Overlay's Approve key is at (0,1) → reply "y\n" to this session.
    deck.press(coordToIndex(0, 1));

    await vi.waitFor(() => {
      const reply = recorded.find((r) => r.op === 'term.reply');
      expect(reply).toBeDefined();
      expect(reply!.args).toEqual({ sessionId: 's-1', text: 'y\n' });
    });

    await app.stop();
    expect(deck.closed).toBe(true);
  });

  it('spawns an agent into a project via the Projects view', async () => {
    const dataDir = freshDir();
    const recorded = await startControlPlane(dataDir, { projects: [PROJECT] });

    const deck = new FakeDeck();
    const app = createDeckApp(deck, { dataDir, pollIntervalMs: 10_000 });
    await app.start();

    deck.press(coordToIndex(0, 0)); // hub → menu
    deck.press(coordToIndex(1, 0)); // menu → Projects (fetch-on-open)

    await vi.waitFor(() => expect(recorded.some((r) => r.op === 'project.list')).toBe(true));

    deck.press(coordToIndex(0, 0)); // first project tile → project actions
    deck.press(coordToIndex(0, 1)); // "+ claude" spawn

    await vi.waitFor(() => {
      const spawn = recorded.find((r) => r.op === 'term.create');
      expect(spawn).toBeDefined();
      expect(spawn!.args).toEqual({ projectId: 'p-1', profile: 'claude' });
    });

    await app.stop();
  });

  it('offers every harness.list profile as a spawn button (codex here)', async () => {
    const dataDir = freshDir();
    const recorded = await startControlPlane(dataDir, {
      projects: [PROJECT],
      // Third profile (index 2) sits at (2,1) in the overlay's action row.
      profiles: [
        { id: 'claude', family: 'claude', label: 'Claude', yolo: false },
        { id: 'claude-yolo', family: 'claude', label: 'Claude Yolo', yolo: true },
        { id: 'codex', family: 'codex', label: 'Codex', yolo: false }
      ]
    });

    const deck = new FakeDeck();
    const app = createDeckApp(deck, { dataDir, pollIntervalMs: 10_000 });
    await app.start();

    deck.press(coordToIndex(0, 0)); // hub → menu
    deck.press(coordToIndex(1, 0)); // menu → Projects (fetch-on-open)

    await vi.waitFor(() => expect(recorded.some((r) => r.op === 'harness.list')).toBe(true));

    deck.press(coordToIndex(0, 0)); // first project tile → project actions
    deck.press(coordToIndex(2, 1)); // third spawn button → codex

    await vi.waitFor(() => {
      const spawn = recorded.find((r) => r.op === 'term.create');
      expect(spawn).toBeDefined();
      expect(spawn!.args).toEqual({ projectId: 'p-1', profile: 'codex' });
    });

    await app.stop();
  });

  it('toggles a schedule from enabled to disabled via the Schedules view', async () => {
    const dataDir = freshDir();
    const recorded = await startControlPlane(dataDir, { schedules: [SCHEDULE] });

    const deck = new FakeDeck();
    const app = createDeckApp(deck, { dataDir, pollIntervalMs: 10_000 });
    await app.start();

    deck.press(coordToIndex(0, 0)); // hub → menu
    deck.press(coordToIndex(2, 0)); // menu → Schedules (fetch-on-open)

    await vi.waitFor(() => expect(recorded.some((r) => r.op === 'sched.list')).toBe(true));

    deck.press(coordToIndex(0, 0)); // first schedule tile → schedule actions
    deck.press(coordToIndex(1, 1)); // "Disable" (schedule is enabled) → toggle

    await vi.waitFor(() => {
      const toggle = recorded.find((r) => r.op === 'sched.setEnabled');
      expect(toggle).toBeDefined();
      expect(toggle!.args).toEqual({ id: 'sc-1', enabled: false });
    });

    await app.stop();
  });

  it('fetches the status overview via the Status view', async () => {
    const dataDir = freshDir();
    const recorded = await startControlPlane(dataDir, {
      agents: [AGENT],
      projects: [PROJECT],
      schedules: [SCHEDULE]
    });

    const deck = new FakeDeck();
    const app = createDeckApp(deck, { dataDir, pollIntervalMs: 10_000 });
    await app.start();

    deck.press(coordToIndex(0, 0)); // hub → menu
    deck.press(coordToIndex(3, 0)); // menu → Status (fetch-on-open)

    await vi.waitFor(() => expect(recorded.some((r) => r.op === 'status')).toBe(true));
    // Status page rendered count tiles (row 0 has blits).
    await vi.waitFor(() => expect(deck.blits.length).toBeGreaterThan(0));

    await app.stop();
  });
});
