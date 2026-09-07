import { queueAgentScriptOpen } from './agent-script-open.js';

export const AGENTFORCE_PLAYGROUND_ACTION = 'playground';
export const AGENTFORCE_PREVIEW_ACTION = 'preview';

export function parseAgentforcePanelPath(params: unknown): string | undefined {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined;
  const path = (params as { path?: unknown }).path;
  return typeof path === 'string' && path.trim() ? path.trim() : undefined;
}

export function parseAgentforcePanelApiName(params: unknown): string | undefined {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined;
  const apiName = (params as { apiName?: unknown }).apiName;
  return typeof apiName === 'string' && apiName.trim() ? apiName.trim() : undefined;
}

export function agentforcePanelParams(path?: string, apiName?: string): { path?: string; apiName?: string } {
  const next: { path?: string; apiName?: string } = {};
  if (path?.trim()) next.path = path.trim();
  if (apiName?.trim()) next.apiName = apiName.trim();
  return next;
}

export function openAgentforcePlayground(args: {
  openThreadPanel: (options: { actionId: string; title?: string; params?: Record<string, string> }) => boolean;
  projectId: string | null | undefined;
  path?: string;
}): boolean {
  if (args.projectId && args.path) {
    queueAgentScriptOpen(args.projectId, args.path);
  }
  return args.openThreadPanel({
    actionId: AGENTFORCE_PLAYGROUND_ACTION,
    title: 'Playground',
    params: agentforcePanelParams(args.path)
  });
}

export function openAgentforcePreview(args: {
  openThreadPanel: (options: { actionId: string; title?: string; params?: Record<string, string> }) => boolean;
  path?: string;
  apiName?: string;
}): boolean {
  return args.openThreadPanel({
    actionId: AGENTFORCE_PREVIEW_ACTION,
    title: 'Preview',
    params: agentforcePanelParams(args.path, args.apiName)
  });
}
