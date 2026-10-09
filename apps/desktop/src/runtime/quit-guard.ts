/** Fixed-size server result; no thread roster or transcript crosses into main. */
export async function readQuitThreadCount(serverUrl: string, fetcher: typeof fetch = fetch): Promise<number> {
  const response = await fetcher(new URL('api/v1/system/quit-state', serverUrl), {
    signal: AbortSignal.timeout(2_000)
  });
  if (!response.ok) throw new Error(`Quit state: HTTP ${response.status}`);
  const body = await response.json() as { activeThreads?: unknown };
  if (!Number.isSafeInteger(body.activeThreads) || (body.activeThreads as number) < 0) {
    throw new Error('Invalid quit state');
  }
  return body.activeThreads as number;
}

export function createQuitGuard(deps: {
  isConfirmed(): boolean;
  setConfirmed(): void;
  shouldConfirm(): boolean;
  terminalCount(): number;
  threadCount(): Promise<number>;
  confirm(count: number, unknownThreads: boolean): Promise<boolean>;
  quit(): void;
  log(error: unknown): void;
}) {
  let pending = false;
  return {
    /** False means the caller must leave all resources alive until consent. */
    allowQuit(event: { preventDefault(): void }): boolean {
      if (deps.isConfirmed()) return true;
      if (!deps.shouldConfirm()) {
        deps.setConfirmed();
        return true;
      }
      event.preventDefault();
      if (pending) return false;
      pending = true;
      void (async () => {
        let threads = 0;
        let unknownThreads = false;
        try { threads = await deps.threadCount(); }
        catch (error) { unknownThreads = true; deps.log(error); }
        // An update restart may already have obtained consent during the probe.
        if (!deps.isConfirmed()) {
          const count = deps.terminalCount() + threads;
          if ((count > 0 || unknownThreads) && !await deps.confirm(count, unknownThreads)) return;
          deps.setConfirmed();
        }
        deps.quit();
      })().catch(deps.log).finally(() => { pending = false; });
      return false;
    }
  };
}
