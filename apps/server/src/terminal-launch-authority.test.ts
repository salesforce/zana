import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  TERMINAL_HOST_PROTOCOL_VERSION,
  type TerminalHostBinding,
  type TerminalRequestCommand
} from '@zana-ai/zcc-contracts/terminal-execution';
import type { ProjectRecord, ProjectStore } from './project-store.js';
import { createTerminalLaunchAuthority } from './terminal-launch-authority.js';
import type { TerminalSessionRecord } from './terminal-session-service.js';

const binding: TerminalHostBinding = {
  hostId: '00000000-0000-4000-8000-000000000001',
  instanceId: '00000000-0000-4000-8000-000000000002',
  hostConnectionId: '00000000-0000-4000-8000-000000000003'
};

function project(path: string, overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return { id: randomUUID(), name: 'Project', path, createdAt: 1, lastActiveAt: 1, ...overrides };
}

function store(records: ProjectRecord[]): ProjectStore {
  return { list: () => records } as ProjectStore;
}

function start(
  record: ProjectRecord,
  cwd: string,
  mode: 'local-pty' | 'remote-ssh' | 'execution-environment' = 'local-pty'
): Extract<TerminalRequestCommand, { kind: 'start' }> {
  return {
    kind: 'start',
    protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
    commandId: randomUUID(),
    sessionId: randomUUID(),
    projectId: record.id,
    launchEpoch: 0,
    deadlineAt: new Date(Date.now() + 30_000).toISOString(),
    launch: {
      argv: ['zsh', '-l', '--', 'literal value'],
      cwd,
      env: { PATH: '/usr/bin', LITERAL: 'a=b c' },
      cols: 80,
      rows: 24,
      mode
    }
  };
}

function liveSession(command: TerminalRequestCommand): TerminalSessionRecord {
  return {
    sessionId: command.sessionId,
    launchEpoch: command.launchEpoch,
    state: 'running',
    accepted: true,
    nextSequence: 0,
    binding
  };
}

function authorityOptions(records: ProjectRecord[], execute: (command: TerminalRequestCommand) => Promise<TerminalHostEvent[]>, sessions = new Map<string, TerminalSessionRecord>()) {
  return {
    projects: store(records),
    binding,
    getSession: (sessionId: string) => sessions.get(sessionId) ?? null,
    execute
  };
}

describe('createTerminalLaunchAuthority', () => {
  it.each(['exact', 'nested'] as const)('accepts an %s local project cwd and forwards its canonical path', async (location) => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-terminal-authority-'));
    const nested = join(root, 'nested');
    mkdirSync(nested);
    const alias = join(tmpdir(), `zcc-terminal-authority-alias-${randomUUID()}`);
    symlinkSync(location === 'exact' ? root : nested, alias);
    const record = project(root);
    const command = start(record, alias);
    const execute = vi.fn(async () => []);
    const authority = createTerminalLaunchAuthority(authorityOptions([record], execute));

    await authority.execute(command);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({ ...command, launch: { ...command.launch, cwd: realpathSync(alias) } });
    const forwarded = execute.mock.calls[0][0] as Extract<TerminalRequestCommand, { kind: 'start' }>;
    expect(forwarded.launch.argv).toBe(command.launch.argv);
    expect(forwarded.launch.env).toBe(command.launch.env);
  });

  it.each([
    ['unknown project', (root: string, record: ProjectRecord) => ({ records: [], command: start(record, root) })],
    ['remote project', (root: string, record: ProjectRecord) => ({ records: [{ ...record, remote: { host: 'example' } }], command: start(record, root) })],
    ['relative cwd', (_root: string, record: ProjectRecord) => ({ records: [record], command: start(record, 'relative') })],
    ['nonexistent cwd', (root: string, record: ProjectRecord) => ({ records: [record], command: start(record, join(root, 'missing')) })],
    ['sibling-prefix cwd', (root: string, record: ProjectRecord) => {
      const sibling = `${root}-sibling`;
      mkdirSync(sibling);
      return { records: [record], command: start(record, sibling) };
    }],
    ['symlink escape', (root: string, record: ProjectRecord) => {
      const outside = mkdtempSync(join(tmpdir(), 'zcc-terminal-authority-outside-'));
      const escaped = join(root, 'escaped');
      symlinkSync(outside, escaped);
      return { records: [record], command: start(record, escaped) };
    }],
    ['remote mode', (root: string, record: ProjectRecord) => ({ records: [record], command: start(record, root, 'remote-ssh') })],
    ['execution-environment mode', (root: string, record: ProjectRecord) => ({ records: [record], command: start(record, root, 'execution-environment') })]
  ])('rejects %s before invoking terminal execution', async (_name, arrange) => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-terminal-authority-'));
    const record = project(root);
    const { records, command } = arrange(root, record);
    const execute = vi.fn(async () => []);
    const authority = createTerminalLaunchAuthority(authorityOptions(records, execute));

    await expect(authority.execute(command)).resolves.toEqual([{
      kind: 'rejected',
      protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
      binding,
      commandId: command.commandId,
      sessionId: command.sessionId,
      launchEpoch: command.launchEpoch,
      reason: 'terminal launch is not authorized'
    }]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('forwards a command for a current live server session unchanged', async () => {
    const command: Extract<TerminalRequestCommand, { kind: 'write' }> = {
      kind: 'write', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, commandId: randomUUID(), sessionId: randomUUID(),
      launchEpoch: 0, deadlineAt: new Date(Date.now() + 30_000).toISOString(), data: 'literal input'
    };
    const execute = vi.fn(async () => []);
    const authority = createTerminalLaunchAuthority(authorityOptions([], execute, new Map([[command.sessionId, liveSession(command)]])));

    await authority.execute(command);

    expect(execute).toHaveBeenCalledWith(command);
  });

  it.each([
    ['unknown session', () => null],
    ['stale epoch', (command: Extract<TerminalRequestCommand, { kind: 'write' }>) => ({ ...liveSession(command), launchEpoch: 1 })],
    ['exited session', (command: Extract<TerminalRequestCommand, { kind: 'write' }>) => ({ ...liveSession(command), state: 'exited' as const })],
    ['replaced host connection', (command: Extract<TerminalRequestCommand, { kind: 'write' }>) => ({
      ...liveSession(command),
      binding: { ...binding, hostConnectionId: randomUUID() }
    })]
  ])('rejects a %s command before the host acts', async (_name, sessionFor) => {
    const command: Extract<TerminalRequestCommand, { kind: 'write' }> = {
      kind: 'write', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, commandId: randomUUID(), sessionId: randomUUID(),
      launchEpoch: 0, deadlineAt: new Date(Date.now() + 30_000).toISOString(), data: 'literal input'
    };
    const execute = vi.fn(async () => []);
    const session = sessionFor(command);
    const sessions = session ? new Map([[command.sessionId, session]]) : new Map<string, TerminalSessionRecord>();
    const authority = createTerminalLaunchAuthority(authorityOptions([], execute, sessions));

    await expect(authority.execute(command)).resolves.toEqual([{
      kind: 'rejected', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, binding,
      commandId: command.commandId, sessionId: command.sessionId, launchEpoch: command.launchEpoch,
      reason: 'terminal launch is not authorized'
    }]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not convert an execution failure into an authorization rejection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-terminal-authority-'));
    const record = project(root);
    const failure = new Error('host unavailable');
    const authority = createTerminalLaunchAuthority(authorityOptions(
      [record],
      async () => { throw failure; }
    ));

    await expect(authority.execute(start(record, root))).rejects.toBe(failure);
  });
});
