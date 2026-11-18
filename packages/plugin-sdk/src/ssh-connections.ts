/** Server-selected SSH identity; a renderer cannot select the connection provider. */
export interface PluginSshIdentity {
  readonly host: string;
  readonly user?: string;
  readonly proxyJump?: string;
}

export interface PluginSshConnectionProvider {
  /** Read-only, bounded ownership check. Must never open a browser or change credentials. */
  owns(remote: PluginSshIdentity, signal: AbortSignal): boolean | Promise<boolean>;
  /** Foreground Connect/Repair only. Honor cancellation; never enroll or recursively reconnect here. */
  prepare(remote: PluginSshIdentity, signal: AbortSignal): Promise<
    { status: 'ready' } | { status: 'blocked'; message: string }
  >;
}

export interface PluginSshConnections {
  /** One provider per plugin generation. Removed, and active preparation aborted, on teardown. */
  register(provider: PluginSshConnectionProvider): void;
}
