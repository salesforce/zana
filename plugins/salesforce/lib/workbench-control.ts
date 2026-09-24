import { randomUUID } from 'node:crypto';

export const UI_COMMANDS = ['state', 'view.open', 'filter.set', 'form.set', 'query.show', 'file.open', 'file.filter', 'panel.open', 'panel.close', 'panel.show', 'panel.hide', 'editor.reveal', 'query.set', 'object.select', 'record.open', 'log.open', 'operation.open'] as const;
export type UiCommandName = typeof UI_COMMANDS[number];
export type ControlState = Record<string, unknown>;
export interface UiCommand { id: string; command: UiCommandName; input: ControlState }
type View = { id: string; scope: string; surface: string; target: string; threadId?: string; at: number; state: ControlState; commands: UiCommandName[] };
type Job = { scope: string; viewId: string; command: UiCommand; at: number; delivered: boolean; result?: { ok: boolean; viewState?: ControlState; error?: string } };
const object = (value: unknown): ControlState => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 200_000) throw Error('Invalid workbench control payload.');
  return value as ControlState;
};
/** Ephemeral scoped views. No action is reported as visible until the renderer acknowledges it. */
export class WorkbenchControl {
  private views = new Map<string, View>();
  private jobs = new Map<string, Job>();
  constructor(private readonly now = Date.now) {}
  dispose() { this.views.clear(); this.jobs.clear(); }
  private prune() {
    for (const [id, view] of this.views) if (this.now() - view.at > 15_000) this.views.delete(id);
    for (const [id, job] of this.jobs) if (this.now() - job.at > 300_000) this.jobs.delete(id);
  }
  register(scope: string, input: unknown, target = '') {
    this.prune(); const row = object(input);
    if (this.views.size >= 40) throw Error('Too many active Salesforce views.');
    if (!['workbench', 'agentforce', 'data', 'apex', 'deployments', 'logs', 'operations'].includes(String(row.surface))) throw Error('Unknown Salesforce surface.');
    if (!Array.isArray(row.commands) || row.commands.some(c => !(UI_COMMANDS as readonly unknown[]).includes(c))) throw Error('Unknown UI command.');
    const view: View = { id: randomUUID(), scope, target, surface: String(row.surface), threadId: typeof row.threadId === 'string' ? row.threadId : undefined, commands: row.commands, state: {}, at: this.now() };
    this.views.set(view.id, view);
    return { viewId: view.id };
  }
  private view(scope: string, id: string) {
    this.prune(); const view = this.views.get(id);
    if (!view || view.scope !== scope) throw Error('This Salesforce view is unavailable. List views and choose one in this project.');
    return view;
  }
  assertTarget(scope: string, id: string, target: string) {
    if (this.view(scope, id).target !== target) throw Error('This view targets a different org. Align its org with the project and list views again.');
  }
  list(scope: string) { this.prune(); return [...this.views.values()].filter(view => view.scope === scope).map(({ scope: _scope, at: _at, ...view }) => view); }
  poll(scope: string, input: unknown) {
    const row = object(input); const view = this.view(scope, String(row.viewId));
    view.at = this.now(); view.state = object(row.state);
    const commands: UiCommand[] = [];
    for (const job of this.jobs.values()) if (job.viewId === view.id && !job.delivered && !job.result && this.now() - job.at < 20_000) { job.delivered = true; commands.push(job.command); }
    return { commands };
  }
  close(scope: string, id: string) { this.view(scope, id); this.views.delete(id); }
  request(scope: string, input: unknown) {
    const row = object(input); const view = this.view(scope, String(row.viewId));
    if (!view.commands.includes(row.command as UiCommandName)) throw Error('This view does not support that command.');
    if (this.jobs.size >= 200 || [...this.jobs.values()].filter(j => j.viewId === view.id && !j.result && this.now() - j.at < 20_000).length >= 8) throw Error('Workbench controls are busy. Wait for pending commands.');
    const id = randomUUID();
    this.jobs.set(id, { scope, viewId: view.id, at: this.now(), delivered: false, command: { id, command: row.command as UiCommandName, input: row.input === undefined ? {} : object(row.input) } });
    return { commandId: id, state: 'pending' };
  }
  private job(scope: string, id: string) { this.prune(); const job = this.jobs.get(id); if (!job || job.scope !== scope) throw Error('UI command not found in this project.'); return job; }
  acknowledge(scope: string, input: unknown) {
    const row = object(input); const job = this.job(scope, String(row.commandId));
    this.view(scope, String(row.viewId));
    if (job.viewId !== row.viewId || !job.delivered || job.result || this.now() - job.at >= 20_000) throw Error('UI acknowledgement is stale.');
    job.result = row.ok === true ? { ok: true, viewState: object(row.state) } : { ok: false, error: typeof row.error === 'string' ? row.error.slice(0, 500) : 'The UI could not apply this command.' };
    return { acknowledged: true };
  }
  result(scope: string, id: string) {
    const job = this.job(scope, id);
    return job.result ? { state: 'completed', ...job.result } : this.now() - job.at >= 20_000 ? { state: 'failed', ok: false, error: 'The view did not acknowledge this command. It may have closed.' } : { state: 'pending' };
  }
}
