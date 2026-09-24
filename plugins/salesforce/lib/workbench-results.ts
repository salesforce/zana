import { randomUUID } from 'node:crypto';

/** Bounded server-owned query snapshots for displaying agent results in the Data view. */
export class WorkbenchResults {
  private rows = new Map<string, { scope: string; orgId: string; value: unknown; at: number }>();
  constructor(private readonly now = Date.now) {}
  dispose() { this.rows.clear(); }
  put(scope: string, orgId: string, value: unknown) {
    if (JSON.stringify(value).length > 300_000) throw Error('Query result is too large to display. Select fewer fields or rows.');
    while (this.rows.size >= 20) this.rows.delete(this.rows.keys().next().value!);
    const id = randomUUID(); this.rows.set(id, { scope, orgId, value, at: this.now() }); return id;
  }
  get(scope: string, orgId: string, id: string) {
    const row = this.rows.get(id);
    if (!row || row.scope !== scope || row.orgId !== orgId || this.now() - row.at > 600_000) throw Error('This query result expired or belongs to another project or org. Run it again.');
    return row.value;
  }
}
