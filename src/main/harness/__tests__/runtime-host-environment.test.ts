import { describe, expect, it } from 'vitest';
import type { RuntimeSupervisor } from '../../runtime-supervisor.js';
import type { TerminalHostEvent } from '@zana-ai/zcc-contracts/terminal-execution';
import { createRuntimeHostExecutionEnvironment } from '../runtime-host-environment.js';

const deadline = '2026-08-19T12:00:05.000Z';

describe('runtime host execution environment', () => {
  it('owns local shell I/O through signed server-host commands', async () => {
    const commands: unknown[] = [];
    let listener: ((event: TerminalHostEvent) => void) | null = null;
    const runtime: RuntimeSupervisor = {
      rendererUrl: 'http://127.0.0.1:1/',
      hostUrl: 'http://127.0.0.1:2',
      hostToken: 'token',
      hostSigningKey: 'key',
      appVersion: async () => '',
      listProjects: async () => [],
      executeTerminal: async (command) => {
        commands.push(command);
        if (command.kind !== 'start') return [];
        return [
          { kind: 'accepted', commandId: command.commandId, sessionId: 'session-1', launchEpoch: 0, hostSessionId: 'host-1' },
          { kind: 'started', sessionId: 'session-1', launchEpoch: 0, pid: 1234 }
        ];
      },
      onTerminalEvent: (next) => {
        listener = next;
        return () => { listener = null; };
      },
      close: async () => {}
    };
    const environment = createRuntimeHostExecutionEnvironment({
      runtime,
      now: () => Date.parse('2026-08-19T12:00:00.000Z'),
      commandId: (() => {
        let next = 1;
        return () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
      })()
    });

    const session = await environment.createSession!(
      { command: '/bin/zsh', args: ['-l'] },
      {
        sessionId: 'session-1',
        projectId: 'project-1',
        cwd: '/workspace',
        cols: 80,
        rows: 24,
        sessionEnv: { ZCC_MCP_URL: 'http://127.0.0.1:3000/mcp' },
        spawnEnv: { PATH: '/usr/bin', ZCC_MCP_URL: 'http://127.0.0.1:3000/mcp' }
      }
    );

    expect(session.pid).toBe(1234);
    expect(commands).toEqual([
      {
        kind: 'start',
        commandId: '00000000-0000-4000-8000-000000000001',
        sessionId: 'session-1',
        launchEpoch: 0,
        deadlineAt: deadline,
        projectId: 'project-1',
        launch: {
          argv: ['/bin/zsh', '-l'],
          cwd: '/workspace',
          env: { PATH: '/usr/bin', ZCC_MCP_URL: 'http://127.0.0.1:3000/mcp' },
          cols: 80,
          rows: 24,
          mode: 'local-pty'
        }
      }
    ]);

    const output: string[] = [];
    const exits: number[] = [];
    session.onData((data) => output.push(data));
    session.onExit(({ exitCode }) => exits.push(exitCode));
    expect(listener).not.toBeNull();
    listener!({ kind: 'output', sessionId: 'session-1', launchEpoch: 0, sequence: 0, data: 'hello' });
    session.write('echo hi\r');
    session.resize(120, 40);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(commands.slice(1)).toEqual([
      expect.objectContaining({ kind: 'write', data: 'echo hi\r', sessionId: 'session-1', launchEpoch: 0, deadlineAt: deadline }),
      expect.objectContaining({ kind: 'resize', cols: 120, rows: 40, sessionId: 'session-1', launchEpoch: 0, deadlineAt: deadline })
    ]);
    listener!({ kind: 'exited', sessionId: 'session-1', launchEpoch: 0, sequence: 1, code: 0, expected: false });
    expect(output).toEqual(['hello']);
    expect(exits).toEqual([0]);

    const expectedSession = await environment.createSession!(
      { command: '/bin/zsh', args: [] },
      { sessionId: 'session-1', projectId: 'project-1', cwd: '/workspace', cols: 80, rows: 24, sessionEnv: {}, spawnEnv: {} }
    );
    expectedSession.terminateExpected!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(commands.at(-1)).toEqual(expect.objectContaining({ kind: 'terminate', expected: true }));
  });

  it('fails closed when the host does not acknowledge a terminal start', async () => {
    const runtime: RuntimeSupervisor = {
      rendererUrl: 'http://127.0.0.1:1/',
      hostUrl: 'http://127.0.0.1:2',
      hostToken: 'token',
      hostSigningKey: 'key',
      appVersion: async () => '',
      listProjects: async () => [],
      executeTerminal: async (command) => [{ kind: 'rejected', commandId: command.commandId, sessionId: command.sessionId, reason: 'host unavailable' }],
      onTerminalEvent: () => () => {},
      close: async () => {}
    };
    const environment = createRuntimeHostExecutionEnvironment({ runtime });

    await expect(environment.createSession!(
      { command: '/bin/zsh', args: [] },
      { sessionId: 'session-1', projectId: 'project-1', cwd: '/workspace', cols: 80, rows: 24, sessionEnv: {}, spawnEnv: {} }
    )).rejects.toThrow('runtime host did not start terminal session');
  });
});
