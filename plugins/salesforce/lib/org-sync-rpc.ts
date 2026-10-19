import { isSyncScope, SYNC_RPC, SYNC_STATES, type SyncState } from './org-sync-contract.js';
import type { OrgSyncService } from './org-sync.js';

const text = (args: unknown, key: string) => {
  const value = args && typeof args === 'object' ? (args as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value : '';
};

/** Fetch latest RPCs. Every call runs against the request's DX project root, resolved by main. */
export function registerOrgSync(input: {
  registerRpc(name: string, handler: (args: unknown) => unknown): void;
  service: OrgSyncService;
  projectRoot(): Promise<string>;
  /** Tells open explorers and editors that files changed on disk. */
  changed(): void;
}) {
  const { registerRpc, service, projectRoot } = input;
  registerRpc(SYNC_RPC.check, async args => {
    const input = args && typeof args === 'object' ? args as Record<string, unknown> : {};
    const scope = text(args, 'scope') || 'all';
    if (!isSyncScope(scope)) throw Error('Choose agentforce, apex or all.');
    const states = Array.isArray(input.states) ? input.states : undefined;
    if (states && !states.every(state => SYNC_STATES.includes(state as SyncState))) throw Error(`Choose states from ${SYNC_STATES.join(', ')}.`);
    const limit = input.limit === undefined ? undefined : Number(input.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw Error('Choose a positive whole-number limit.');
    const agent = text(args, 'agent');
    const check = agent ? await service.checkAgent(await projectRoot(), agent) : await service.check(await projectRoot(), scope);
    // Counts always describe the whole check; states and limit only narrow the listed rows.
    const rows = states ? check.components.filter(row => states.includes(row.state)) : check.components;
    const components = limit === undefined ? rows : rows.slice(0, limit);
    const { current, ...rest } = check;
    return { ok: true, data: { ...rest, components, truncated: check.truncated || components.length < rows.length, ...(input.current === true ? { current } : {}) } };
  });
  registerRpc(SYNC_RPC.start, async args => ({ ok: true, ...await service.start(await projectRoot(), args) }));
  registerRpc(SYNC_RPC.status, async args => ({ ok: true, data: await service.status(await projectRoot(), text(args, 'jobId')) }));
  registerRpc(SYNC_RPC.diff, async args => ({ ok: true, data: await service.diff(await projectRoot(), text(args, 'jobId'), text(args, 'path')) }));
  registerRpc(SYNC_RPC.apply, async args => {
    const data = await service.apply(await projectRoot(), text(args, 'jobId'), args);
    // The files are already written; a failed refresh notice must not report the apply as failed.
    if (data.state === 'applied' && data.written > 0) try { input.changed(); } catch { /* explorers refresh on their next load */ }
    return { ok: true, data };
  });
  registerRpc(SYNC_RPC.cancel, async args => {
    await service.cancel(await projectRoot(), text(args, 'jobId'));
    return { ok: true };
  });
}
