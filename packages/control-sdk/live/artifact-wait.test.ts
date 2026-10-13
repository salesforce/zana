import { expect, it } from 'vitest';
import { waitForArtifact } from './artifact-wait.js';

function scenario(status = 'idle', createdAt = Infinity) {
  let time = 0;
  return { exists: () => time >= createdAt, refresh: async () => ({ status }),
    sleep: async (ms: number) => { time += ms; }, nowMs: () => time, timeoutMs: 1000 };
}
it.each(['idle', 'done', 'working'])('waits for a real artifact after initial %s state', async status => {
  await expect(waitForArtifact(scenario(status, 500))).resolves.toBeUndefined();
});
it('accepts an artifact before inspecting a dead session', async () => {
  await expect(waitForArtifact(scenario('exited', 0))).resolves.toBeUndefined();
});
it('checks for a completed write racing the final status', async () => {
  const args = scenario('exited');
  args.refresh = async () => { args.exists = () => true; return { status: 'exited' }; };
  await expect(waitForArtifact(args)).resolves.toBeUndefined();
});
it('fails on a dead session with no artifact', async () => {
  await expect(waitForArtifact(scenario('exited'))).rejects.toThrow('exited before creating');
});
it('bounds idle sessions and propagates transport errors', async () => {
  await expect(waitForArtifact(scenario())).rejects.toThrow('before the deadline');
  const args = scenario();
  args.refresh = async () => { throw new Error('not found'); };
  await expect(waitForArtifact(args)).rejects.toThrow('not found');
});
