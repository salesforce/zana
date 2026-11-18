import { afterEach, expect, it, vi } from 'vitest';
import { SshConnectionPreparation, type SshConnectionSource } from './ssh-connection-providers.js';

const remote = { host: 'managed', user: 'dev' };
function fixture() {
  const lifetime = new AbortController();
  const owns = vi.fn(async () => true);
  const prepare = vi.fn(async () => ({ status: 'ready' as const }));
  const source: SshConnectionSource = { pluginId: 'provider', name: 'Workspace provider', provider: { owns, prepare }, lifetime: lifetime.signal };
  const sources = [source]; const onProvider = vi.fn(); const request = new AbortController();
  const runner = new SshConnectionPreparation(() => sources);
  const run = () => runner.prepare(remote, request.signal, onProvider);
  return { lifetime, owns, prepare, source, sources, onProvider, request, runner, run };
}
afterEach(() => vi.useRealTimers());
it('selects an owner on the server and passes the validated identity without allowing mutation', async () => {
  const f = fixture(); f.owns.mockImplementationOnce(async identity => { identity.host = 'other'; return false; });
  await f.run(); expect(remote.host).toBe('managed'); expect(f.prepare).not.toHaveBeenCalled(); expect(f.onProvider).not.toHaveBeenCalled();
  await f.run(); expect(f.onProvider).toHaveBeenCalledWith('Workspace provider'); expect(f.prepare).toHaveBeenCalledOnce();
  expect(f.prepare.mock.calls[0][0]).toEqual(remote);
});
it('does nothing when no providers are installed', async () => {
  await expect(new SshConnectionPreparation(() => []).prepare(remote, new AbortController().signal, vi.fn())).resolves.toBeUndefined();
});
it('refuses ambiguous ownership before opening sign-in', async () => {
  const f = fixture(); f.sources.push({ ...f.source, pluginId: 'other' });
  await expect(f.run()).rejects.toThrow('More than one'); expect(f.prepare).not.toHaveBeenCalled();
});
it('returns only explicit public blocked results and bounds their size', async () => {
  const f = fixture(); f.source.provider.prepare = async () => ({ status: 'blocked', message: 'VPN unavailable\n' + 'x'.repeat(500) });
  const error = await f.run().catch(e => e);
  expect(error.code).toBe('connection_preparation_failed'); expect(error.message).not.toContain('\n'); expect(error.message).toHaveLength(300);
});
it.each([undefined, { status: 'blocked', message: '' }, { status: 'other' }])('fails closed on invalid results %j', async result => {
  const f = fixture(); f.source.provider.prepare = async () => result as never;
  await expect(f.run()).rejects.toThrow('Could not prepare');
});
it('hides private thrown errors from ownership and preparation', async () => {
  const f = fixture(); f.owns.mockRejectedValueOnce(Error('SECRET'));
  await expect(f.run()).rejects.toThrow('Could not check');
  f.prepare.mockRejectedValueOnce(Error('SECRET'));
  await expect(f.run()).rejects.toThrow('Could not prepare the connection with Workspace provider');
  await expect(f.run()).resolves.toBeUndefined(); // Failure releases the preparation slot.
});
it('serializes one provider across different workspaces without starting another browser', async () => {
  const f = fixture(); let finish!: () => void;
  f.prepare.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ status: 'ready' }); }));
  const first = f.run(); await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
  await expect(f.runner.prepare({ host: 'another' }, f.request.signal, f.onProvider)).rejects.toThrow('already being prepared');
  expect(f.prepare).toHaveBeenCalledOnce(); finish(); await first; await f.run();
});
it.each(['request', 'lifetime'] as const)('cancels an active callback on %s abort even when it ignores cancellation', async reason => {
  const f = fixture(); f.prepare.mockImplementationOnce(() => new Promise(() => {}));
  const pending = f.run(); const assertion = expect(pending).rejects.toThrow('Could not prepare');
  await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce()); f[reason].abort(); await assertion;
  expect(f.prepare.mock.calls[0][1].aborted).toBe(true);
});
it.each(['owns', 'prepare'] as const)('bounds a hung %s callback and cleans its timer', async method => {
  vi.useFakeTimers(); const f = fixture(); f[method].mockImplementationOnce(() => new Promise(() => {}));
  const pending = f.run(); const assertion = expect(pending).rejects.toThrow(method === 'owns' ? 'Could not check' : 'Could not prepare');
  await vi.advanceTimersByTimeAsync(method === 'owns' ? 5001 : 360001); await assertion;
  expect(vi.getTimerCount()).toBe(0);
});
it('never invokes a provider after its generation or request was already cancelled', async () => {
  const f = fixture(); f.lifetime.abort(); await expect(f.run()).rejects.toThrow('Could not check'); expect(f.owns).not.toHaveBeenCalled();
  const empty = new SshConnectionPreparation(() => []); f.request.abort(); await expect(empty.prepare(remote, f.request.signal, vi.fn())).rejects.toThrow();
});
