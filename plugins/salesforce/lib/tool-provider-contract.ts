/** Portable host contract: neither the UI nor other plugins depend on toolkit internals. */
export type SalesforceToolProvider = 'builtin' | 'toolkit' | 'both';
export interface SalesforceToolCallContext {
  projectId: string;
  threadId?: string;
  signal?: AbortSignal;
}
export interface SalesforceToolService {
  toolCatalog(): Promise<unknown>;
  toolDescribe(name: string): Promise<unknown>;
  toolInvoke(name: string, input: unknown, context: SalesforceToolCallContext, resumeId?: string): Promise<unknown>;
  toolReadResult(runId: string, context: SalesforceToolCallContext, selection?: { pointer?: string; offset?: number; limit?: number }): Promise<unknown>;
}
export interface ToolkitDescription {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  actions: Record<string, { available: boolean; effects?: boolean; dryRun?: boolean; reason?: string }>;
  guidance: string[];
}
export interface ToolkitRuntime {
  executeTool(name: string, input: unknown, options: { workspace: string; artifactDir: string; targetOrg?: string; allowEffects: boolean; signal: AbortSignal; resume?: string; timeoutMs: number }): Promise<any>;
  toModelResult(result: any, options: { maxBytes: number }): any;
  readResult(path: string, selection: { pointer?: string; offset?: number; limit?: number }): Promise<any>;
}
