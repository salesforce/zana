import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { startHostDaemon, type HostDaemon } from '@zana-ai/zcc-host-daemon';
import { createTerminalExecutionService, signTerminalCommand } from './terminal-execution-service.js';
import { TERMINAL_HOST_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/terminal-execution';

const binding = { hostId: randomUUID(), instanceId: randomUUID(), hostConnectionId: randomUUID() };

let daemon: HostDaemon | null = null;

afterEach(async () => {
  await daemon?.close();
  daemon = null;
});

describe('terminal execution service', () => {
  it('canonicalizes signatures independent of input key order', () => {
    const base = {
      kind: 'start' as const, protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, binding, commandId: randomUUID(), sessionId: randomUUID(), projectId: randomUUID(), launchEpoch: 0,
      deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      launch: { argv: ['zsh'], cwd: '/tmp', env: { PATH: '/usr/bin' }, cols: 120, rows: 40, mode: 'local-pty' as const }
    };
    expect(signTerminalCommand(base, 's'.repeat(32)).signature).toBe(signTerminalCommand({ ...base, launch: { ...base.launch, env: { PATH: '/usr/bin' } } }, 's'.repeat(32)).signature);
  });

  it('signs server-authorized terminal commands for the paired host only', async () => {
    const token = 't'.repeat(32);
    const signingKey = 's'.repeat(32);
    const terminalManager = {
      handle: (command: { commandId: string; sessionId: string; launchEpoch: number }) => [{
        kind: 'accepted', commandId: command.commandId, sessionId: command.sessionId,
        protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
        binding,
        launchEpoch: command.launchEpoch, hostSessionId: 'host-session'
      }]
    } as never;
    daemon = await startHostDaemon({ token, signingKey, hostId: binding.hostId, instanceId: binding.instanceId, terminalManager });
    const service = createTerminalExecutionService({ hostUrl: daemon.url, token, signingKey, binding });
    await service.connect();
    const events = await service.execute({
      kind: 'start', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, commandId: randomUUID(), sessionId: randomUUID(), projectId: randomUUID(), launchEpoch: 0,
      deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      launch: { argv: ['zsh'], cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' }, cols: 120, rows: 40, mode: 'local-pty' }
    });
    expect(events).toEqual([expect.objectContaining({ kind: 'accepted', hostSessionId: 'host-session' })]);
  });
});
