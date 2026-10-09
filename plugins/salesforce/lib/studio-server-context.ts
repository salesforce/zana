// lib/plugin.ts is the only lib file allowed to import the host SDK (sdk-portable.guard); SDK types are re-exported from it.
import type { SalesforceHostApi, SalesforceHostToolContext } from './plugin.js';
import type { AgentforceLab } from './agentforce-lab.js';
import type { ProjectContexts } from './project-context.js';
import type { SalesforceSdk } from './sdk-contract.js';
import type { PluginSettingsValues, SalesforceDeps } from './types.js';
import type { WorkbenchControl } from './workbench-control.js';

/**
 * Everything a Studio `register*` function needs from lib/plugin.ts. Passing one
 * object keeps the factory in plugin.ts small and lets each workstream own its file.
 */
export interface StudioServerContext {
  zcc: SalesforceHostApi;
  /** Wraps zcc.rpc.method: runs the handler inside the project context and converts throws to {ok:false,code,error}. */
  registerRpc: (name: string, handler: (args: unknown) => unknown) => void;
  contexts: ProjectContexts;
  control: WorkbenchControl;
  lab: AgentforceLab;
  sdk: SalesforceSdk;
  readSettings: () => Promise<PluginSettingsValues>;
  deps: SalesforceDeps;
  invokeAction: (action: string, input: unknown, ctx: SalesforceHostToolContext) => Promise<unknown>;
}

/**
 * RPC/result convention of this plugin: failures are returned (never thrown) as
 * `{ ok: false, code: string, error: string }`; successes carry `ok: true`.
 */
export interface RpcFailure { ok: false; code: string; error: string }

export function rpcFailure(code: string, error: string): RpcFailure {
  return { ok: false, code, error };
}

/** Result returned by every Studio RPC whose owning workstream has not landed yet. */
export function notImplemented(rpc: string): RpcFailure {
  return rpcFailure('not_implemented', `${rpc} is not implemented yet.`);
}

/** Registers `names` as stub RPCs that answer `not_implemented`. */
export function registerStubRpcs(studio: Pick<StudioServerContext, 'registerRpc'>, names: readonly string[]): void {
  for (const name of names) studio.registerRpc(name, () => notImplemented(name));
}

export function rpcString(args: unknown, key: string): string {
  if (!args || typeof args !== 'object') return '';
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}
