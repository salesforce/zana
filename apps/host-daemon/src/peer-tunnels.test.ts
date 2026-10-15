import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import type { spawn } from 'node:child_process';
import { PeerTunnels, peerTunnelFailure } from './peer-tunnels.js';

afterEach(() => vi.useRealTimers());
function fixture() {
  const processes: any[] = [];
  const spawnProcess = vi.fn(() => {
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), killed: false,
      kill: vi.fn(() => { proc.killed = true; queueMicrotask(() => proc.emit('close', 1)); }) });
    processes.push(proc); return proc;
  });
  return { tunnels: new PeerTunnels(spawnProcess as unknown as typeof spawn), processes, spawnProcess };
}
const ready = (proc: any) => proc.stdout.write('ZCC-PEER-TUNNEL-READY\n');

it('waits for forwarding readiness, reuses a pending connection and owns shutdown', async () => {
  const f = fixture();
  const first = f.tunnels.open({ host: 'pony', user: 'me', proxyJump: 'bastion' }, 8780, 28888);
  const second = f.tunnels.open({ host: 'pony', user: 'me', proxyJump: 'bastion' }, 8780, 28888);
  let resolved = false; void second.then(() => { resolved = true; }); await Promise.resolve(); expect(resolved).toBe(false);
  ready(f.processes[0]); await Promise.all([first, second]);
  await f.tunnels.open({ host: 'pony', user: 'me', proxyJump: 'bastion' }, 8780, 28888);
  expect(f.spawnProcess).toHaveBeenCalledOnce();
  const args = (f.spawnProcess.mock.calls[0] as any)[1];
  expect(args).toContain('127.0.0.1:28888:127.0.0.1:8780'); expect(args).toContain('ControlPath=none');
  expect(args).toContain('me@pony'); expect(args).toContain('bastion');
  f.tunnels.close(); f.tunnels.close(); expect(f.processes[0].kill).toHaveBeenCalledOnce();
});

it('rejects bounded SSH errors, clears failed tunnels and permits another attempt', async () => {
  const f = fixture(), pending = f.tunnels.open({ host: 'pony' }, 8780, 28888);
  f.processes[0].stderr.write('x'.repeat(10000) + ' forwarding refused'); f.processes[0].emit('close', 255);
  await expect(pending).rejects.toThrow('forwarding refused');
  const next = f.tunnels.open({ host: 'pony' }, 8780, 28888); ready(f.processes[1]); await next; f.tunnels.close();
});

it('times out a silent connection and handles executable errors', async () => {
  vi.useFakeTimers(); const f = fixture();
  const pending = f.tunnels.open({ host: 'pony' }, 8780, 28888); const rejection = expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(30000); await rejection; expect(f.processes[0].kill).toHaveBeenCalled();
  const failed = f.tunnels.open({ host: 'pony' }, 8780, 28888); f.processes[1].emit('error', new Error('ENOENT'));
  await expect(failed).rejects.toThrow('ENOENT'); f.tunnels.close(); expect(vi.getTimerCount()).toBe(0);
});

it('reconnects dropped connections, retries failed reconnects and cancels retries on close', async () => {
  vi.useFakeTimers(); const f = fixture();
  const pending = f.tunnels.open({ host: 'pony' }, 8780, 28888); ready(f.processes[0]); await pending;
  f.processes[0].emit('close', 255); await vi.advanceTimersByTimeAsync(3000);
  f.processes[1].emit('close', 255); await vi.advanceTimersByTimeAsync(3000);
  ready(f.processes[2]); await Promise.resolve();
  f.processes[2].emit('close', 255); f.tunnels.close(); await vi.advanceTimersByTimeAsync(30000);
  expect(f.spawnProcess).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
});

it('rejects invalid ports and bounds owned connections', async () => {
  const f = fixture();
  for (const port of [0, 65536, 1.5, NaN]) await expect(f.tunnels.open({ host: 'pony' }, port, 28888)).rejects.toThrow('Invalid');
  for (let i = 0; i < 64; i++) { const pending = f.tunnels.open({ host: `pony-${i}` }, 8780, 28888); ready(f.processes[i]); await pending; }
  await expect(f.tunnels.open({ host: 'extra' }, 8780, 28888)).rejects.toThrow('Too many'); f.tunnels.close();
});

it('removes one tunnel without stopping another machine', async () => {
  const f = fixture();
  const first = f.tunnels.open({ host: 'pony' }, 8780, 28888); ready(f.processes[0]); await first;
  const second = f.tunnels.open({ host: 'other' }, 8780, 28888); ready(f.processes[1]); await second;
  f.tunnels.remove({ host: 'pony' }, 8780, 28888); f.tunnels.remove({ host: 'missing' }, 8780, 28888);
  expect(f.processes[0].kill).toHaveBeenCalledOnce(); expect(f.processes[1].kill).not.toHaveBeenCalled(); f.tunnels.close();
});

it('tags a remote port conflict so the primary can pick another port', async () => {
  const f = fixture(), pending = f.tunnels.open({ host: 'pony' }, 8780, 28888);
  f.processes[0].stderr.write('Error: remote port forwarding failed for listen port 28888\n'); f.processes[0].emit('close', 255);
  await expect(pending).rejects.toMatchObject({ code: 'peer_tunnel_port_unavailable', message: expect.stringContaining('remote port forwarding failed') });
  const other = f.tunnels.open({ host: 'pony' }, 8780, 28889); f.processes[1].emit('close', 255);
  await expect(other).rejects.toMatchObject({ code: 'peer_tunnel_failed', message: 'SSH tunnel closed before connecting' });
  expect(peerTunnelFailure('ssh: Could not resolve hostname pony')).toMatchObject({ code: 'peer_tunnel_failed' });
  f.tunnels.close();
});

it('replaces the tunnel for a machine reopened on new ports instead of duplicating it', async () => {
  const f = fixture();
  const first = f.tunnels.open({ host: 'pony', user: 'me' }, 8780, 28888); ready(f.processes[0]); await first;
  const moved = f.tunnels.open({ host: 'pony', user: 'me' }, 9911, 28888); ready(f.processes[1]); await moved;
  expect(f.processes[0].kill).toHaveBeenCalledOnce();
  expect((f.spawnProcess.mock.calls[1] as any)[1]).toContain('127.0.0.1:28888:127.0.0.1:9911');
  await f.tunnels.open({ host: 'pony', user: 'me' }, 9911, 28888);
  expect(f.spawnProcess).toHaveBeenCalledTimes(2);
  f.tunnels.remove({ host: 'pony', user: 'me' }, 8780, 28888);
  expect(f.processes[1].kill).not.toHaveBeenCalled();
  f.tunnels.remove({ host: 'pony', user: 'me' }, 9911, 28888);
  expect(f.processes[1].kill).toHaveBeenCalledOnce();
  f.tunnels.close();
});

it('a superseded pending open rejects without dropping its replacement', async () => {
  const f = fixture();
  const stale = f.tunnels.open({ host: 'pony' }, 8780, 28888);
  const rejection = expect(stale).rejects.toMatchObject({ code: 'peer_tunnel_failed' });
  const fresh = f.tunnels.open({ host: 'pony' }, 8780, 28999);
  await rejection; ready(f.processes[1]); await fresh;
  await f.tunnels.open({ host: 'pony' }, 8780, 28999);
  expect(f.spawnProcess).toHaveBeenCalledTimes(2); f.tunnels.close();
});

it('closes a removed machine tunnel whatever its ports and stops reconnecting', async () => {
  vi.useFakeTimers(); const f = fixture();
  const first = f.tunnels.open({ host: 'pony', user: 'me' }, 9911, 28888); ready(f.processes[0]); await first;
  const other = f.tunnels.open({ host: 'other' }, 8780, 28888); ready(f.processes[1]); await other;
  expect(f.tunnels.closeFor({ host: 'pony', user: 'me' })).toBe(true);
  expect(f.processes[0].kill).toHaveBeenCalledOnce(); expect(f.processes[1].kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30000);
  expect(f.spawnProcess).toHaveBeenCalledTimes(2);
  expect(f.tunnels.closeFor({ host: 'pony', user: 'me' })).toBe(false);
  f.tunnels.close();
});
