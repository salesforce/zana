import { randomUUID } from 'node:crypto';
import { isProposalOutcome, type ProposalOutcome } from './studio-contract.js';
import { STUDIO_UI_COMMANDS, validateUiCommandInput } from './ui-command-input.js';

/** View lease TTL; renderers re-poll well inside this (realtime wake + 5s fallback). */
export const VIEW_LEASE_MS = 20_000;
/** A delivered command must be acknowledged within this window. */
export const ACK_WINDOW_MS = 20_000;
/** How long a human-paced command (awaiting_user) may wait for control.outcome. */
export const AWAITING_USER_TTL_MS = 600_000;
export const MAX_RESULT_WAIT_MS = 20_000;
const MAX_WAITERS = 100;
const MAX_AWAITING_PER_VIEW = 4;

export const UI_COMMANDS = ['state', 'view.open', 'filter.set', 'form.set', 'query.show', 'file.open', 'file.filter', 'panel.open', 'panel.close', 'panel.show', 'panel.hide', 'editor.reveal', 'query.set', 'object.select', 'record.open', 'log.open', 'operation.open', ...STUDIO_UI_COMMANDS] as const;
export type UiCommandName = typeof UI_COMMANDS[number];
export type ControlState = Record<string, unknown>;
export interface UiCommand { id: string; command: UiCommandName; input: ControlState }
type View = { id: string; scope: string; surface: string; target: string; threadId?: string; at: number; state: ControlState; commands: UiCommandName[] };
export interface ControlResult { ok: boolean; viewState?: ControlState; error?: string; outcome?: ProposalOutcome }
type Job = { scope: string; viewId: string; command: UiCommand; at: number; touched: number; delivered: boolean; awaiting?: { proposalId: string; at: number; viewState: ControlState }; result?: ControlResult };
export type WakeListener = (viewId: string) => void;
const object = (value: unknown): ControlState => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 200_000) throw Error('Invalid workbench control payload.');
  return value as ControlState;
};
/** Ephemeral scoped views. No action is reported as visible until the renderer acknowledges it. */
export class WorkbenchControl {
  private views = new Map<string, View>();
  private jobs = new Map<string, Job>();
  private waiters = new Map<string, Set<() => void>>();
  private wake?: WakeListener;
  constructor(private readonly now = Date.now) {}
  /** Invoked with the target viewId whenever a command is queued (the plugin publishes UI_WAKE_CHANNEL). */
  setWakeListener(listener: WakeListener | undefined) { this.wake = listener; }
  dispose() {
    this.wake = undefined;
    for (const waiters of [...this.waiters.values()]) for (const release of [...waiters]) release();
    this.waiters.clear(); this.views.clear(); this.jobs.clear();
  }
  private prune() {
    for (const [id, view] of this.views) if (this.now() - view.at > VIEW_LEASE_MS) this.views.delete(id);
    for (const [id, job] of this.jobs) if (this.now() - job.touched > (job.awaiting && !job.result ? AWAITING_USER_TTL_MS : 300_000)) { this.jobs.delete(id); this.release(id); }
  }
  private release(jobId: string) { for (const release of [...(this.waiters.get(jobId) ?? [])]) release(); }
  private waitFor(jobId: string, ms: number): Promise<void> {
    let count = 0; for (const set of this.waiters.values()) count += set.size;
    if (count >= MAX_WAITERS) return Promise.resolve();
    return new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => { if (timer) clearTimeout(timer); const set = this.waiters.get(jobId); set?.delete(done); if (set && !set.size) this.waiters.delete(jobId); resolve(); };
      timer = setTimeout(done, ms); timer.unref?.();
      const set = this.waiters.get(jobId) ?? new Set(); set.add(done); this.waiters.set(jobId, set);
    });
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
    for (const job of this.jobs.values()) if (job.viewId === view.id && !job.delivered && !job.result && this.now() - job.at < ACK_WINDOW_MS) { job.delivered = true; job.touched = this.now(); commands.push(job.command); }
    return { commands };
  }
  close(scope: string, id: string) { this.view(scope, id); this.views.delete(id); }
  request(scope: string, input: unknown) {
    const row = object(input); const view = this.view(scope, String(row.viewId));
    if (!view.commands.includes(row.command as UiCommandName)) throw Error('This view does not support that command.');
    const commandInput = row.input === undefined ? {} : object(row.input);
    const problem = validateUiCommandInput(String(row.command), commandInput);
    if (problem) throw Error(problem);
    const live = [...this.jobs.values()].filter(j => j.viewId === view.id && !j.result && !j.awaiting && this.now() - j.at < ACK_WINDOW_MS).length;
    if (this.jobs.size >= 200 || live >= 8) throw Error('Workbench controls are busy. Wait for pending commands.');
    const id = randomUUID(); const at = this.now();
    this.jobs.set(id, { scope, viewId: view.id, at, touched: at, delivered: false, command: { id, command: row.command as UiCommandName, input: commandInput } });
    try { this.wake?.(view.id); } catch { /* a failed wake only delays delivery to the next poll */ }
    return { commandId: id, state: 'pending' };
  }
  private job(scope: string, id: string) { this.prune(); const job = this.jobs.get(id); if (!job || job.scope !== scope) throw Error('UI command not found in this project.'); return job; }
  acknowledge(scope: string, input: unknown) {
    const row = object(input); const job = this.job(scope, String(row.commandId));
    this.view(scope, String(row.viewId));
    if (job.viewId !== row.viewId || !job.delivered || job.result || job.awaiting || this.now() - job.at >= ACK_WINDOW_MS) throw Error('UI acknowledgement is stale.');
    job.touched = this.now();
    if (row.ok === true && row.pending === 'user') {
      if (typeof row.proposalId !== 'string' || !row.proposalId || row.proposalId.length > 200) throw Error('A pending acknowledgement needs a proposalId.');
      const awaiting = [...this.jobs.values()].filter(j => j.viewId === job.viewId && j.awaiting && !j.result).length;
      if (awaiting >= MAX_AWAITING_PER_VIEW) throw Error('Too many proposals are awaiting the user in this view.');
      job.awaiting = { proposalId: row.proposalId, at: this.now(), viewState: object(row.state) };
      this.release(job.command.id);
      return { acknowledged: true, state: 'awaiting_user', proposalId: row.proposalId };
    }
    job.result = row.ok === true ? { ok: true, viewState: object(row.state) } : { ok: false, error: typeof row.error === 'string' ? row.error.slice(0, 500) : 'The UI could not apply this command.' };
    this.release(job.command.id);
    return { acknowledged: true };
  }
  /** Human-paced completion: the renderer reports how the user resolved a proposal. */
  outcome(scope: string, input: unknown) {
    const row = object(input); const job = this.job(scope, String(row.commandId));
    this.view(scope, String(row.viewId));
    if (job.viewId !== row.viewId || !job.awaiting || job.result) throw Error('No proposal is awaiting the user for this command.');
    if (this.now() - job.awaiting.at >= AWAITING_USER_TTL_MS) throw Error('This proposal expired before the user responded.');
    if (!isProposalOutcome(row.outcome)) throw Error('Invalid proposal outcome.');
    job.result = { ok: true, viewState: job.awaiting.viewState, outcome: row.outcome }; job.touched = this.now();
    this.release(job.command.id);
    return { recorded: true };
  }
  result(scope: string, id: string): { state: string } & Partial<ControlResult> & { proposalId?: string } {
    const job = this.job(scope, id);
    if (job.result) return { state: 'completed', ...job.result };
    if (job.awaiting) return this.now() - job.awaiting.at >= AWAITING_USER_TTL_MS
      ? { state: 'failed', ok: false, error: 'The user did not respond to the proposal in time.' }
      : { state: 'awaiting_user', proposalId: job.awaiting.proposalId };
    return this.now() - job.at >= ACK_WINDOW_MS ? { state: 'failed', ok: false, error: 'The view did not acknowledge this command. It may have closed.' } : { state: 'pending' };
  }
  /** Like result(), but long-polls (<= 20s) while the command is pending or awaiting the user. */
  async resultWait(scope: string, id: string, waitMs: unknown) {
    const first = this.result(scope, id);
    const ms = typeof waitMs === 'number' && Number.isFinite(waitMs) ? Math.min(Math.max(Math.floor(waitMs), 0), MAX_RESULT_WAIT_MS) : 0;
    if (!ms || (first.state !== 'pending' && first.state !== 'awaiting_user')) return first;
    await this.waitFor(id, ms);
    return this.result(scope, id);
  }
}
