import type { PluginSshConnectionProvider, PluginSshIdentity } from '@zana-ai/zcc-plugin-sdk/server';

export class SshPreparationError extends Error {
  readonly code = 'connection_preparation_failed';
}

export interface SshConnectionSource {
  pluginId: string;
  name: string;
  provider: PluginSshConnectionProvider;
  lifetime: AbortSignal;
}

/** Bound plugin callbacks even when a plugin fails to honor cancellation. Never expose thrown output. */
async function bounded<T>(signal: AbortSignal, ms: number, run: (signal: AbortSignal) => Promise<T> | T): Promise<T> {
  const timeout = new AbortController();
  const combined = AbortSignal.any([signal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(), ms);
  let onAbort: () => void = () => {};
  try {
    combined.throwIfAborted();
    return await Promise.race([
      Promise.resolve().then(() => { combined.throwIfAborted(); return run(combined); }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('Connection preparation cancelled or timed out.'));
        combined.addEventListener('abort', onAbort, { once: true });
      })
    ]);
  } finally {
    clearTimeout(timer);
    combined.removeEventListener('abort', onAbort);
  }
}

/** Only explicit HTTP connection requests reach this service; automatic host recovery does not. */
export class SshConnectionPreparation {
  private busy = new Set<string>();
  constructor(private sources: () => SshConnectionSource[]) {}

  async prepare(remote: PluginSshIdentity, signal: AbortSignal, onProvider: (name: string) => void): Promise<void> {
    // Snapshot generations. A replaced/disabled provider cannot finish preparing an old request.
    // Check providers concurrently so the discovery deadline stays bounded as plugins grow.
    const matches = await Promise.all(this.sources().map(async source => {
      const lifetime = AbortSignal.any([signal, source.lifetime]);
      try {
        return await bounded(lifetime, 5_000, s => source.provider.owns({ ...remote }, s)) === true ? source : null;
      } catch {
        throw new SshPreparationError('Could not check the SSH connection provider. Retry after checking Plugins.');
      }
    }));
    const owners = matches.filter((source): source is SshConnectionSource => source !== null);
    signal.throwIfAborted();
    if (owners.length > 1) throw new SshPreparationError('More than one plugin manages this SSH host. Disable the duplicate connection provider before retrying.');
    const source = owners[0];
    if (!source) return;
    const name = source.name.replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 100);
    if (this.busy.has(source.pluginId)) throw new SshPreparationError(`A connection is already being prepared with ${name}. Finish it before retrying.`);
    this.busy.add(source.pluginId);
    try {
      onProvider(name);
      const lifetime = AbortSignal.any([signal, source.lifetime]);
      const result = await bounded(lifetime, 360_000, s => source.provider.prepare({ ...remote }, s));
      lifetime.throwIfAborted();
      if (result?.status === 'blocked' && typeof result.message === 'string' && result.message.trim()) {
        // Only the explicit public result is shown; exception messages can contain credentials.
        throw new SshPreparationError(result.message.replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 300));
      }
      if (result?.status !== 'ready') throw new Error('Invalid provider result');
    } catch (error) {
      if (error instanceof SshPreparationError) throw error;
      throw new SshPreparationError(`Could not prepare the connection with ${name}. Check sign-in and your network, then retry.`);
    } finally {
      this.busy.delete(source.pluginId);
    }
  }
}
