/**
 * Tests for the first-run dependency doctor — CLI detection + auto-install of
 * installable companions. `node:child_process`.execFile is mocked with a
 * per-command script so we can drive present / missing without spawning.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupStatus } from '@zana-ai/zcc-domain/product';

/**
 * Command router for the execFile mock. Keys are `cmd argv.join(' ')`; values
 * are the {error, stdout, stderr} to return. A missing key ⇒ ENOENT.
 */
let cmdMap: Record<string, { err?: boolean; stdout?: string; stderr?: string }> = {};

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
    cb(hit.err ? new Error('failed') : null, hit.stdout ?? '', hit.stderr ?? '');
  }
}));

const { createDoctor, hasMissingDeps } = await import('./dependency-doctor.js');

const ALL_IDS = [
  'claude-cli',
  'cursor-cli',
  'opencode-cli',
  'pi-cli',
  'codex-cli',
  'sf-cli'
] as const;

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

const idsOf = (status: SetupStatus) => status.items.map((i) => i.id);

const ALL_PRESENT: Record<string, { stdout: string }> = {
  'claude --version': { stdout: '2.1.260 (Claude Code)' },
  'cursor-agent --version': { stdout: '2026.1.0' },
  'opencode --version': { stdout: '1.2.3' },
  'pi --version': { stdout: '0.4.1' },
  'codex --version': { stdout: 'codex-cli 0.136.0' },
  'sf --version': { stdout: '@salesforce/cli/2.50.0 darwin-arm64' }
};

describe('dependency doctor — detection', () => {
  beforeEach(() => {
    cmdMap = {};
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists Claude, Cursor, OpenCode, Pi, Codex, and SF CLIs and marks them missing when absent', async () => {
    const { deps } = makeDeps();
    const doctor = createDoctor(deps);
    await doctor.check();
    const s = doctor.snapshot();
    expect(idsOf(s)).toEqual([...ALL_IDS]);
    for (const id of ALL_IDS) expect(phaseOf(s, id)).toBe('missing');
    expect(hasMissingDeps(s)).toBe(true);
    expect(s.busy).toBe(false);
  });

  it('reports every CLI as present on a fully set-up machine', async () => {
    cmdMap = { ...ALL_PRESENT };
    const { deps } = makeDeps();
    const doctor = createDoctor(deps);
    await doctor.check();
    const s = doctor.snapshot();
    expect(idsOf(s)).toEqual([...ALL_IDS]);
    for (const id of ALL_IDS) expect(phaseOf(s, id)).toBe('present');
    expect(s.items.find((i) => i.id === 'claude-cli')?.note).toBe('2.1.260 (Claude Code)');
    expect(hasMissingDeps(s)).toBe(false);
  });

  it('does not auto-open when only optional CLIs are missing', async () => {
    cmdMap = { 'claude --version': { stdout: '2.1.260 (Claude Code)' } };
    const { deps } = makeDeps();
    const doctor = createDoctor(deps);
    await doctor.check();
    const s = doctor.snapshot();
    expect(phaseOf(s, 'claude-cli')).toBe('present');
    expect(phaseOf(s, 'cursor-cli')).toBe('missing');
    expect(phaseOf(s, 'sf-cli')).toBe('missing');
    expect(hasMissingDeps(s)).toBe(false);
  });

  it('pushes the snapshot on the deps:onStatus channel', async () => {
    const { sent, deps } = makeDeps();
    const doctor = createDoctor(deps);
    await doctor.check();
    expect(sent.some((m) => m.channel === 'deps:onStatus')).toBe(true);
  });
});

describe('dependency doctor — install / dismiss', () => {
  beforeEach(() => {
    cmdMap = {};
  });

  it('installs a missing npm-global CLI and leaves already-present ones alone', async () => {
    cmdMap = {
      'claude --version': { stdout: '2.1.260 (Claude Code)' },
      'cursor-agent --version': { stdout: '2026.1.0' },
      'pi --version': { stdout: '0.4.1' },
      'codex --version': { stdout: 'codex-cli 0.136.0' },
      'sf --version': { stdout: '@salesforce/cli/2.50.0' }
    };
    const { deps } = makeDeps();
    const doctor = createDoctor(deps);
    await doctor.check();
    expect(phaseOf(doctor.snapshot(), 'opencode-cli')).toBe('missing');

    cmdMap['npm install -g opencode-ai@latest'] = { stdout: 'added 1 package' };
    cmdMap['opencode --version'] = { stdout: '1.2.3' };
    await doctor.install();

    const s = doctor.snapshot();
    expect(phaseOf(s, 'opencode-cli')).toBe('installed');
    expect(s.items.find((i) => i.id === 'opencode-cli')?.note).toBe('1.2.3');
    expect(phaseOf(s, 'pi-cli')).toBe('present');
    expect(s.busy).toBe(false);
  });

  it('fails an npm install step without throwing', async () => {
    cmdMap = { ...ALL_PRESENT };
    delete cmdMap['sf --version'];
    const { deps } = makeDeps();
    const doctor = createDoctor(deps);
    await doctor.check();
    cmdMap['npm install -g @salesforce/cli@latest'] = { err: true, stderr: 'EACCES: permission denied' };
    await doctor.install();
    expect(phaseOf(doctor.snapshot(), 'sf-cli')).toBe('failed');
    expect(doctor.snapshot().items.find((i) => i.id === 'sf-cli')?.note).toContain('permission denied');
  });

  it('installs the Cursor CLI via its official script', async () => {
    cmdMap = { ...ALL_PRESENT };
    delete cmdMap['cursor-agent --version'];
    const { deps } = makeDeps();
    const doctor = createDoctor(deps);
    await doctor.check();
    cmdMap['sh -c curl -fsSL https://cursor.com/install | bash'] = { stdout: 'installed' };
    cmdMap['cursor-agent --version'] = { stdout: '2026.1.0' };
    await doctor.install();
    expect(phaseOf(doctor.snapshot(), 'cursor-cli')).toBe('installed');
  });

  it('dismiss() persists the flag', () => {
    const { getDismissed, deps } = makeDeps();
    const doctor = createDoctor(deps);
    doctor.dismiss();
    expect(getDismissed()).toBe(true);
  });
});
