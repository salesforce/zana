import type { StudioServerContext } from './studio-server-context.js';
import { rpcString } from './studio-server-context.js';

/**
 * True when executing a UI command makes the workbench read the selected org, so
 * the agent-facing `ui.command` action must pass the org-read guardrail.
 * (Moved verbatim from lib/plugin.ts `uiReadsOrg`.)
 */
export function uiCommandReadsOrg(command: unknown, input: Record<string, unknown> | undefined): boolean {
  return ['object.select', 'record.open', 'log.open'].includes(String(command))
    || (command === 'view.open' && input?.view !== 'agentforce')
    || (command === 'panel.open' && ['agents', 'org-preview'].includes(String(input?.tool)));
}

/** Registers the control.* renderer RPCs backed by WorkbenchControl. Owner of later changes: WS-2. */
export function registerControlRpc({ registerRpc, control, contexts }: Pick<StudioServerContext, 'registerRpc' | 'control' | 'contexts'>): void {
  const controlScope = () => contexts.current()?.projectId ?? 'global';
  registerRpc('control.register', args => ({ ok: true, ...control.register(controlScope(), args, contexts.current()?.settings.defaultOrg ?? '') }));
  registerRpc('control.poll', args => { control.assertTarget(controlScope(), rpcString(args, 'viewId'), contexts.current()?.settings.defaultOrg ?? ''); return { ok: true, ...control.poll(controlScope(), args) }; });
  registerRpc('control.close', args => { control.close(controlScope(), rpcString(args, 'viewId')); return { ok: true }; });
  registerRpc('control.ack', args => ({ ok: true, ...control.acknowledge(controlScope(), args) }));
  registerRpc('control.views', () => ({ ok: true, views: control.list(controlScope()) }));
  registerRpc('control.command', args => ({ ok: true, ...control.request(controlScope(), args) }));
  registerRpc('control.result', args => ({ ok: true, ...control.result(controlScope(), rpcString(args, 'commandId')) }));
}
