/** Closed product service surface. Native windows, files, credentials and arbitrary IPC are excluded. */
export const SHARED_PRODUCT_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  config: ['get', 'set'],
  projects: ['ensureQuickAgent', 'remove'],
  terminals: ['list', 'create', 'write', 'reply', 'resize', 'close', 'backlog', 'setHeartbeat', 'setHeadless', 'agentStatusSnapshot', 'agentStatusSince', 'subagentSnapshot', 'subagentChildrenSnapshot', 'sessionStats', 'clearAgentBlocked'],
  projectSettings: ['get', 'set'],
  scheduler: ['list', 'get', 'reload', 'create', 'update', 'delete', 'setEnabled', 'runNow', 'reconcile', 'listTemplates'],
  'scheduler.groups': ['list', 'create', 'update', 'delete', 'reorder'],
  goals: ['list', 'create', 'update', 'delete', 'setStatus', 'runNow', 'reconcile'],
  followups: ['list', 'create', 'update', 'delete', 'setStatus', 'markSpawned'],
  feed: ['list', 'refresh', 'digest'],
  personas: ['list', 'save', 'duplicate', 'delete', 'contribute'],
  teams: ['list', 'save', 'duplicate', 'delete', 'startJob', 'contribute'],
  executionBoard: ['listProject', 'snapshot', 'readArtifact', 'dismiss', 'stop', 'retry', 'retryWork', 'releaseWork', 'reassignWork', 'respond', 'resume', 'retryDelivery', 'clearResumeToken'],
  quickPrompts: ['list', 'save', 'delete'],
  extensions: ['list']
};
export const SHARED_PRODUCT_METHODS: ReadonlyMap<string, string> = new Map(Object.entries(SHARED_PRODUCT_FAMILIES).flatMap(([family, methods]) => methods.map(method => [
  `${family}.${method}`,
  family === 'scheduler.groups' ? `scheduler:groups:${method}` : `${family}:${method}`
])));
export const SHARED_PRODUCT_EVENTS: ReadonlyMap<string, string> = new Map([
  ...['config', 'projectSettings', 'scheduler', 'goals', 'followups', 'feed', 'personas', 'teams', 'quickPrompts'].map(family => [`${family}.onChanged`, `${family}:onChanged`] as [string, string]),
  ...['onData', 'onExit', 'onTitle', 'onUpdated', 'onAgentStatus', 'onSubagents', 'onSubagentChildren', 'onIdleTriage', 'onCatchUpSummary', 'onOverseerActivity', 'onCliPlan'].map(method => [`terminals.${method}`, `terminals:${method}`] as [string, string]),
  ['scheduler.onTemplatesChanged', 'scheduler:onTemplatesChanged'],
  ['scheduler.groups.onChanged', 'scheduler:groups:onChanged'],
  ['extensions.onChanged', 'extensions:onChanged']
]);
export function validSharedProductCall(value: unknown): value is { method: string; args: unknown[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.method === 'string' && SHARED_PRODUCT_METHODS.has(row.method) && Array.isArray(row.args) && row.args.length <= 8 && Object.keys(row).every(key => key === 'method' || key === 'args');
}
