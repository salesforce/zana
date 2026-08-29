import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { startHostDaemon, type HostDaemon } from '@zana-ai/zcc-host-daemon';
import { createHostExecutionService } from './execution-service.js';

let daemon: HostDaemon | null = null;

afterEach(async () => {
  await daemon?.close();
  daemon = null;
});

describe('host execution service', () => {
  it('issues signed commands only through the paired host daemon', async () => {
    const token = 't'.repeat(32);
    const signingKey = 's'.repeat(32);
    daemon = await startHostDaemon({ token, signingKey });
    const service = createHostExecutionService({ hostUrl: daemon.url, token, signingKey });
    const events = await service.execute({
      kind: 'launch',
      commandId: randomUUID(),
      projectId: randomUUID(),
      sessionId: randomUUID(),
      deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      launch: { argv: [process.execPath, '-e', 'process.stdout.write("server")'], cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' } }
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'accepted' }),
      expect.objectContaining({ kind: 'output', data: 'server' }),
      expect.objectContaining({ kind: 'exited', code: 0 })
    ]));
  });
});
