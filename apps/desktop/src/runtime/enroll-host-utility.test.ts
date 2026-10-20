import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { SERVER_RUNTIME_PROTOCOL_VERSION as protocolVersion } from '@zana-ai/zcc-contracts/runtime';
import { enrollHostUtility } from './enroll-host-utility.js';

const input = { serverUrl: 'http://127.0.0.1:8780', token: 'fixture', dataDir: '/fixture' };
const hostId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
class Child extends EventEmitter { postMessage = vi.fn(); }
afterEach(() => { vi.useRealTimers(); });

it.each(['enroll', 'relaunch'] as const)('returns the enrolled product identity and removes its listener after %s', async type => {
  const child = new Child();
  const result = enrollHostUtility(child, input, type);
  for (const unrelated of [null, 'ready', { type: 'ready', hostId: 'private-runtime-id' }]) child.emit('message', unrelated);
  expect(child.listenerCount('message')).toBe(1);
  child.emit('message', { type: 'enrolled', protocolVersion, hostId });
  await expect(result).resolves.toBe(hostId);
  expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type, protocolVersion, ...input, provenance: 'non-tunnel', replaceEnrollment: false }));
  expect(child.listenerCount('message')).toBe(0);
});

it.each([
  { type: 'enrolled', hostId },
  { type: 'enrolled', protocolVersion: protocolVersion - 1, hostId },
  { type: 'enrolled', protocolVersion },
  { type: 'enrolled', protocolVersion, hostId: 'private-runtime-id' },
  { type: 'error', protocolVersion, message: 'enrollment revoked' }
])('rejects malformed or failed acknowledgements: %j', async message => {
  const child = new Child();
  const result = enrollHostUtility(child, input);
  child.emit('message', message);
  await expect(result).rejects.toThrow();
  expect(child.listenerCount('message')).toBe(0);
});

it.each(['enroll', 'relaunch'] as const)('bounds a missing %s acknowledgement and ignores late replies', async type => {
  vi.useFakeTimers();
  const child = new Child();
  const result = enrollHostUtility(child, input, type);
  const checked = expect(result).rejects.toThrow(`host ${type} timed out`);
  await vi.advanceTimersByTimeAsync(20_000);
  await checked;
  expect(child.listenerCount('message')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  child.emit('message', { type: 'enrolled', protocolVersion, hostId });
});

it.each(['enroll', 'relaunch'] as const)('reports an unlabelled %s failure', async type => {
  const child = new Child();
  const result = enrollHostUtility(child, input, type);
  child.emit('message', { type: 'error', protocolVersion });
  await expect(result).rejects.toThrow(`host ${type} failed`);
});

it.each([new Error('closed'), 'closed'])('cleans up when sending the request fails (%s)', async error => {
  vi.useFakeTimers();
  const child = new Child();
  child.postMessage.mockImplementation(() => { throw error; });
  await expect(enrollHostUtility(child, input)).rejects.toThrow();
  expect(child.listenerCount('message')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
