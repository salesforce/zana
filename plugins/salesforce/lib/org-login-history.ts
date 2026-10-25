interface Entry { id: string; projectId: string | null; at: number; result: unknown }
/** Only public terminal results: no credentials or in-flight browser state. */
export class OrgLoginHistory {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly key = 'sf:login-results:v1';
  constructor(private readonly kv: { get<T>(key: string): Promise<T | null | undefined>; set(key: string, value: unknown): Promise<void> }, private readonly now: () => number) {}
  private async entries(): Promise<Entry[]> {
    const value = await this.kv.get<Entry[]>(this.key);
    return Array.isArray(value) ? value.slice(-12).filter(row => row && typeof row.id === 'string' && Number.isFinite(row.at) && this.now() - row.at < 15 * 60_000) : [];
  }
  async get(id: string, projectId: string | null): Promise<unknown | undefined> {
    await this.chain;
    return (await this.entries()).find(row => row.id === id && row.projectId === projectId)?.result;
  }
  put(id: string, projectId: string | null, result: unknown): Promise<void> {
    const next = this.chain.catch(() => undefined).then(async () => {
      // Login results contain only the public roster. Cap unusually large orgs.
      if (JSON.stringify(result).length > 500_000) return;
      const rows = (await this.entries()).filter(row => row.id !== id);
      await this.kv.set(this.key, [...rows, { id, projectId, at: this.now(), result }].slice(-12));
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}
