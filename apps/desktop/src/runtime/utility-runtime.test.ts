import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUtilityRuntime } from './runtime-supervisor.js';
import { SERVER_RUNTIME_PROTOCOL_VERSION as protocolVersion } from '@zana-ai/zcc-contracts/runtime';
function fixture() {
  const child = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn(), pid: 42 });
  const gone = vi.fn();
  const runtime = createUtilityRuntime({ child, url: 'http://localhost/' }, gone);
  return { child, gone, runtime };
}
afterEach(() => vi.useRealTimers());
describe('utility process lifecycle', () => {
  it('allows bounded long plugin CLI work while ordinary requests retain their short deadline', async () => {
    vi.useFakeTimers(); const { child, runtime } = fixture();
    const pending = runtime.request('plugins-cli-run', 'plugin', ['open'], { threadId: 'thread' });
    const message = child.postMessage.mock.calls[0]![0];
    expect(Date.parse(message.deadlineAt) - Date.now()).toBe(300_000);
    await vi.advanceTimersByTimeAsync(25_000);
    child.emit('message', { type: 'result', protocolVersion, id: message.id, value: { exitCode: 0 } });
    expect(await pending).toEqual({ exitCode: 0 });
    expect(vi.getTimerCount()).toBe(0);
    const timeout = expect(runtime.request('plugins-cli-run', 'plugin', ['hang'])).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(300_000); await timeout;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('gives plugin RPCs the long plugin budget so slow CLI-backed handlers are not cut off at 20s', async () => {
    vi.useFakeTimers(); const { child, runtime } = fixture();
    const pending = runtime.request('plugins-call-rpc', 'salesforce', 'agentPreview.start', { live: true });
    const message = child.postMessage.mock.calls[0]![0];
    expect(message).toMatchObject({ operation: 'plugins-call-rpc', pluginId: 'salesforce', method: 'agentPreview.start', args: { live: true } });
    expect(Date.parse(message.deadlineAt) - Date.now()).toBe(300_000);
    await vi.advanceTimersByTimeAsync(60_000);
    child.emit('message', { type: 'result', protocolVersion, id: message.id, value: { ok: true } });
    expect(await pending).toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects pending and future calls immediately after a crash', async () => {
    vi.useFakeTimers(); const { child, runtime, gone } = fixture();
    const first = runtime.request('projects-list');
    const rejected = expect(first).rejects.toThrow('exited');
    child.emit('exit', 9); await rejected;
    await expect(runtime.request('projects-list')).rejects.toThrow('Restart Zana');
    expect(gone).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    await runtime.stop(); expect(child.postMessage).toHaveBeenCalledTimes(1);
  });
  it('cleans a rejected postMessage and times out an unresponsive child', async () => {
    vi.useFakeTimers(); const { child, runtime } = fixture();
    child.postMessage.mockImplementationOnce(() => { throw new Error('closed channel'); });
    await expect(runtime.request('projects-list')).rejects.toThrow('closed channel');
    expect(vi.getTimerCount()).toBe(0);
    const request = expect(runtime.request('projects-list')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(20_000); await request; expect(vi.getTimerCount()).toBe(0);
  });
  it('resolves responses, ignores malformed messages and clears response timers', async () => {
    vi.useFakeTimers(); const { child, runtime } = fixture();
    const pending = runtime.request('projects-list');
    const { id } = child.postMessage.mock.calls[0]![0];
    child.emit('message', {}); child.emit('message', { type: 'result', protocolVersion, id: 'unknown', value: [] });
    child.emit('message', { type: 'result', protocolVersion, id, value: [{ id: 'project' }] });
    expect(await pending).toEqual([{ id: 'project' }]); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([true, false])('does not report deliberate shutdown as a crash, graceful=%s', async graceful => {
    vi.useFakeTimers(); const { child, runtime, gone } = fixture();
    const stopped = runtime.stop();
    await expect(runtime.request('projects-list')).rejects.toThrow('Restart Zana');
    if (graceful) child.emit('message', { type: 'stopped', protocolVersion });
    else await vi.advanceTimersByTimeAsync(3000);
    await stopped; child.emit('exit', 0);
    expect(gone).not.toHaveBeenCalled(); expect(child.kill).toHaveBeenCalledTimes(graceful ? 0 : 1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
describe('plugins-tool-policy requests', () => {
  const call = { invocationId: 'c'.repeat(64), threadId: 'session-1', projectId: 'project-1', profile: 'claude', toolName: 'Bash', input: { command: 'pwd' } };
  it('posts the main-asserted call and resolves the reply, clearing its timer', async () => {
    vi.useFakeTimers(); const { child, runtime } = fixture();
    const pending = runtime.request('plugins-tool-policy', call);
    const message = child.postMessage.mock.calls[0]![0];
    expect(message).toEqual({
      type: 'request', protocolVersion, id: expect.any(String), deadlineAt: expect.any(String),
      operation: 'plugins-tool-policy', request: call
    });
    child.emit('message', { type: 'result', protocolVersion, id: message.id, value: { action: 'allow' } });
    expect(await pending).toEqual({ action: 'allow' }); expect(vi.getTimerCount()).toBe(0);
  });
  it('attaches the domain code of an error reply to the rejection and leaves plain failures codeless', async () => {
    vi.useFakeTimers(); const { child, runtime } = fixture();
    const coded = runtime.request('plugins-call-rpc', 'demo', 'op', {});
    child.emit('message', { type: 'error', protocolVersion, id: child.postMessage.mock.calls[0]![0].id, message: 'keep one file', code: 'invalid' });
    await expect(coded).rejects.toMatchObject({ message: 'keep one file', code: 'invalid' });
    const plain = runtime.request('plugins-call-rpc', 'demo', 'op', {});
    child.emit('message', { type: 'error', protocolVersion, id: child.postMessage.mock.calls[1]![0].id, message: 'boom' });
    const error = await plain.catch((e: Error) => e);
    expect(error).toMatchObject({ message: 'boom' }); expect(error).not.toHaveProperty('code');
  });
  it('rejects on an error reply, on silence and on child exit without leaving timers', async () => {
    vi.useFakeTimers(); const { child, runtime } = fixture();
    const failed = expect(runtime.request('plugins-tool-policy', call)).rejects.toThrow('invalid server runtime message');
    child.emit('message', { type: 'error', protocolVersion, id: child.postMessage.mock.calls[0]![0].id, message: 'invalid server runtime message' });
    await failed;
    const silent = expect(runtime.request('plugins-tool-policy', call)).rejects.toThrow('server plugins-tool-policy request timed out');
    await vi.advanceTimersByTimeAsync(20_000); await silent; expect(vi.getTimerCount()).toBe(0);
    const orphaned = expect(runtime.request('plugins-tool-policy', call)).rejects.toThrow('server utility process exited');
    child.emit('exit', 1); await orphaned; expect(vi.getTimerCount()).toBe(0);
  });
});
