import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TERMINAL_HOST_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/terminal-execution';

// The once-only native kill is keyed on the object handed to
// terminatePtyProcessTree. The enrolled-pty and terminal-manager callers pass a
// wrapper around the node-pty instance, so these tests go through the real
// production spawn adapters (createEnrolledPty's default spawn and
// createLocalPtyTerminalManager) and count kills on the underlying native pty.
interface NativePty {
  pid: number;
  kills: number;
  write(): void;
  resize(): void;
  pause(): void;
  resume(): void;
  onData(): void;
  onExit(): void;
  kill(): void;
}

const natives: NativePty[] = [];
let nextPid = 9300;

vi.mock('node-pty', () => ({
  spawn: () => {
    const native: NativePty = {
      pid: nextPid++,
      kills: 0,
      write() {},
      resize() {},
      pause() {},
      resume() {},
      onData() {},
      onExit() {},
      kill() { native.kills += 1; }
    };
    natives.push(native);
    return native;
  }
}));

const stopWindowsProcessTree = vi.fn();
vi.mock('@zana-ai/zcc-agent-process-utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  stopWindowsProcessTree: (pid: number) => stopWindowsProcessTree(pid)
}));

const { createEnrolledPty } = await import('../enrolled-pty.js');
const { createLocalPtyTerminalManager } = await import('../local-pty-host.js');

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

function startCommand() {
  const binding = { hostId: randomUUID(), instanceId: randomUUID(), hostConnectionId: randomUUID() };
  const sessionId = randomUUID();
  return {
    binding,
    sessionId,
    start: {
      kind: 'start' as const, protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, binding, commandId: randomUUID(), sessionId, projectId: randomUUID(), launchEpoch: 0,
      deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      launch: { argv: ['cmd.exe'], cwd: '/tmp', env: { PATH: 'C:/Windows' }, cols: 120, rows: 40, mode: 'local-pty' as const }
    }
  };
}

describe('Windows once-only pty kill through the production callers', () => {
  beforeEach(() => {
    natives.length = 0;
    stopWindowsProcessTree.mockReset();
    setPlatform('win32');
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
    vi.restoreAllMocks();
  });

  it('enrolled-pty: stopTerminal then dispose closes the native pty once', async () => {
    const pty = createEnrolledPty({ emit: () => {}, shell: 'cmd.exe' });
    const id = randomUUID();
    await pty.startTerminal({ sessionId: id, cwd: '/tmp', cols: 80, rows: 24 });
    const handleKills = () => natives[0]!.kills;

    await pty.stopTerminal({ sessionId: id });
    pty.dispose();
    await pty.stopTerminal({ sessionId: id });

    expect(handleKills()).toBe(1);
  });

  it('enrolled-pty: stopOverflowedTerminal twice closes the native pty once', async () => {
    const pty = createEnrolledPty({ emit: () => {}, shell: 'cmd.exe' });
    const id = randomUUID();
    await pty.startTerminal({ sessionId: id, cwd: '/tmp', cols: 80, rows: 24 });

    pty.stopOverflowedTerminal(id);
    pty.stopOverflowedTerminal(id);

    expect(natives[0]!.kills).toBe(1);
  });

  it('terminal-manager: terminate then host close closes the native pty once', () => {
    const manager = createLocalPtyTerminalManager(() => {});
    const { start, binding } = startCommand();
    manager.handle(start);
    const { projectId: _projectId, launch: _launch, ...base } = start;

    manager.handle({ ...base, kind: 'terminate', commandId: randomUUID(), expected: true });
    manager.close();
    manager.revokeBinding(binding);

    expect(natives[0]!.kills).toBe(1);
  });

  it('terminal-manager: revoking a binding then closing the host closes the native pty once', () => {
    const manager = createLocalPtyTerminalManager(() => {});
    const { start, binding } = startCommand();
    manager.handle(start);

    manager.revokeBinding(binding);
    manager.close();

    expect(natives[0]!.kills).toBe(1);
  });
});
