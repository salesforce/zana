/**
 * Tests for the first-run dependency doctor — the detection sweep + the
 * auto-install of the installable pieces. `node:child_process`.execFile is
 * mocked with a per-command script so we can drive "claude present / missing",
 * "@zana-ai/mcp installed / not", etc., without spawning anything. The bundled-
 * extension scan over `node:fs/promises` is mocked to an empty dir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupStatus } from '@zana-ai/zcc-domain/product';

/**
 * Command router for the execFile mock. Keys are `cmd argv.join(' ')`; values
 * are the {error, stdout} to return. A missing key ⇒ ENOENT (command absent).
 */
let cmdMap: Record<string, { err?: boolean; stdout?: string }> = {};

vi.mock('node:child_process', () => ({
  execFile: (
    cmd: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void
  ) => {
    const key = `${cmd} ${args.join(' ')}`;
    const hit = cmdMap[key];
    if (!hit) {
      cb(new Error(`ENOENT: ${key}`), '', 'not found');
      return;
    }
    cb(hit.err ? new Error('failed') : null, hit.stdout ?? '', '');
  }
}));

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(async () => []),
  readFile: vi.fn(async () => '{}')
}));

const { createDoctor, hasMissingDeps } = await import('./dependency-doctor.js');

function makeDeps() {
  const sent: Array<{ channel: string; args: unknown[] }> = [];
  let dismissed = false;
  return {
    sent,
    getDismissed: () => dismissed,
    deps: {
      safeSend: (channel: string, ...args: unknown[]) => sent.push({ channel, args }),
      log: () => {},
      setDismissed: (d: boolean) => {
        dismissed = d;
      }
    }
  };
}

const phaseOf = (status: SetupStatus, id: string) =>
  status.items.find((i) => i.id === id)?.phase;

describe('dependency doctor — detection', () => {
  beforeEach(() => {
    cmdMap = {};
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('marks everything missing when no companion tool is on PATH', async () => {
    const { deps } = makeDeps();
    const doctor = createDoctor(deps);
    await doctor.check();
    const s = doctor.snapshot();
    expect(phaseOf(s, 'claude-cli')).toBe('missing');
    expect(phaseOf(s, 'zana-mcp')).toBe('missing');
    expect(phaseOf(s, 'zana-plugins')).toBe('missing');
    expect(hasMissingDeps(s)).toBe(true);
    expect(s.busy).toBe(false);
  });

  it('reports a fully set-up machine as all-present', async () => {
    // Mirrors a real machine: MCP registered via `npx -y @zana-ai/mcp` with NO
    // global npm install (npm ls would exit 1 — deliberately omitted here), and
    // the plugins actually installed (not just the marketplace configured).
    cmdMap = {
      'claude --version': { stdout: '1.2.3 (Claude Code)' },
      'claude mcp get zana': { stdout: 'zana:\n  Status: ✔ Connected\n  Command: npx' },
      'claude plugin list': { stdout: '  ❯ zana@zana-marketplace\n  ❯ zana-loop@zana-marketplace' }
    };
    const { deps } = makeDeps();
    const doctor = createDoctor(deps);
    await doctor.check();
    const s = doctor.snapshot();
    expect(phaseOf(s, 'claude-cli')).toBe('present');
    expect(phaseOf(s, 'zana-mcp')).toBe('present');
    expect(phaseOf(s, 'zana-plugins')).toBe('present');
    expect(hasMissingDeps(s)).toBe(false);
  });

  it('counts the MCP as present from `claude mcp get` alone (npx, no npm global)', async () => {
    // The regression that real-command probing caught: a working npx-based MCP
    // has `npm ls -g @zana-ai/mcp` exit 1, but `claude mcp get zana` succeeds.
    // Registration is authoritative — the machine must NOT be flagged missing.
    cmdMap = {
      'claude --version': { stdout: '1.2.3' },
      'claude mcp get zana': { stdout: 'zana:\n  Status: ✔ Connected' }
      // no `npm ls` entry ⇒ npm global absent; must still be "present"
    };
    const { deps } = makeDeps();
    const doctor = createDoctor(deps);
    await doctor.check();
    expect(phaseOf(doctor.snapshot(), 'zana-mcp')).toBe('present');
  });

  it('treats a configured marketplace with no installed plugin as missing', async () => {
    cmdMap = {
      'claude --version': { stdout: '1.2.3' },
      'claude mcp get zana': { stdout: 'zana: ✔ Connected' },
      // plugin list does NOT contain zana@zana-marketplace ⇒ not installed
      'claude plugin list': { stdout: '  ❯ something-else@aisuite' }
    };
    const { deps } = makeDeps();
    const doctor = createDoctor(deps);
    await doctor.check();
    expect(phaseOf(doctor.snapshot(), 'zana-plugins')).toBe('missing');
  });

  it('pushes the snapshot on the deps:onStatus channel', async () => {
    const { sent, deps } = makeDeps();
    const doctor = createDoctor(deps);
    await doctor.check();
    expect(sent.some((m) => m.channel === 'deps:onStatus')).toBe(true);
  });
});

describe('dependency doctor — install', () => {
  beforeEach(() => {
    cmdMap = {};
  });

  it('installs + registers the Zana MCP when claude is present', async () => {
    // claude present; nothing else installed yet.
    cmdMap = {
      'claude --version': { stdout: '1.2.3' },
      // detection: mcp not registered, no zana plugin installed
      'claude plugin list': { stdout: '  ❯ other@aisuite' },
      // install steps succeed:
      'npm install -g @zana-ai/mcp@latest': { stdout: 'added 1 package' },
      'claude mcp get zana': { err: true }, // not yet registered → triggers add
      'claude mcp add zana -- npx -y @zana-ai/mcp': { stdout: 'Added' },
      'claude plugin marketplace list': { err: true }, // marketplace absent → triggers add
      'claude plugin marketplace add grebmann1/zana': { stdout: 'Added marketplace' },
      'claude plugin install zana@zana-marketplace': { stdout: 'ok' },
      'claude plugin install zana-loop@zana-marketplace': { stdout: 'ok' }
    };
    const { deps } = makeDeps();
    const doctor = createDoctor(deps);
    await doctor.check();
    await doctor.install();
    const s = doctor.snapshot();
    expect(phaseOf(s, 'zana-mcp')).toBe('installed');
    expect(phaseOf(s, 'zana-plugins')).toBe('installed');
  });

  it('fails the MCP step gracefully when npm install errors', async () => {
    cmdMap = {
      'claude --version': { stdout: '1.2.3' },
      'claude plugin list': { stdout: '  ❯ other@aisuite' },
      'npm install -g @zana-ai/mcp@latest': { err: true }
    };
    const { deps } = makeDeps();
    const doctor = createDoctor(deps);
    await doctor.check();
    await doctor.install();
    expect(phaseOf(doctor.snapshot(), 'zana-mcp')).toBe('failed');
  });

  it('dismiss() persists the flag', () => {
    const { getDismissed, deps } = makeDeps();
    const doctor = createDoctor(deps);
    doctor.dismiss();
    expect(getDismissed()).toBe(true);
  });
});
