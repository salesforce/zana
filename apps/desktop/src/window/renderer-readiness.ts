export class RendererReadiness {
  private readonly ready = new Set<number>();
  private readonly waiters = new Map<number, Set<(ready: boolean) => void>>();

  markReady(windowId: number): void {
    this.ready.add(windowId);
    const waiters = this.waiters.get(windowId);
    if (!waiters) return;
    this.waiters.delete(windowId);
    for (const resolve of waiters) resolve(true);
  }

  reset(windowId: number): void {
    this.ready.delete(windowId);
  }

  remove(windowId: number): void {
    this.ready.delete(windowId);
    const waiters = this.waiters.get(windowId);
    if (!waiters) return;
    this.waiters.delete(windowId);
    for (const resolve of waiters) resolve(false);
  }

  wait(windowId: number, timeoutMs: number): Promise<boolean> {
    if (this.ready.has(windowId)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiters = this.waiters.get(windowId) ?? new Set();
      this.waiters.set(windowId, waiters);
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        waiters.delete(finish);
        if (waiters.size === 0) this.waiters.delete(windowId);
        resolve(result);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      waiters.add(finish);
    });
  }
}
