import { mkdtemp, realpath, rm, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import catalog from '../vendor/catalog.json';
import type { SalesforceSdk } from './sdk-contract.js';
import type { SalesforceToolCallContext, SalesforceToolProvider, ToolkitDescription, ToolkitRuntime } from './tool-provider-contract.js';
import { confinedToolkitPath, isLocalToolkitCall, prepareToolkitInput, redactToolkitResult, toolkitRequiresApproval } from './toolkit-policy.js';

const descriptions = catalog.tools as unknown as ToolkitDescription[];
export const TOOLKIT_AGENT_TOOLS = ['sf_tools', 'sf_flow', 'code_analyzer', 'sf_metadata'];
export const BUILTIN_AGENT_TOOLS = ['sf_soql', 'sf_apex', 'sf_lwc', 'sf_agent'];
export function toolProvider(value: unknown): SalesforceToolProvider {
  return value === 'builtin' || value === 'toolkit' ? value : 'both';
}
export function providerTools(provider: SalesforceToolProvider, salesforceReady: boolean): string[] {
  return [
    ...(provider !== 'toolkit' && salesforceReady ? BUILTIN_AGENT_TOOLS : []),
    'sf_workbench',
    ...(provider !== 'toolkit' && !salesforceReady ? ['sf_agent'] : []),
    ...(provider !== 'builtin' ? TOOLKIT_AGENT_TOOLS : [])
  ];
}
export interface ToolkitScope { projectId: string; workspace: string; orgAlias: string; }
interface SavedRun { projectId: string; workspace: string; org: string | null; runFile: string; resultFile: string; directory: string; }

/** Host adapter; the optional execution package is accessed only through loadRuntime. */
export class SalesforceToolkitAdapter {
  private root?: Promise<string>;
  private runs = new Map<string, SavedRun>();
  private active = new Set<AbortController>();
  private disposed = false;
  constructor(private readonly deps: {
    provider(): Promise<SalesforceToolProvider>;
    scope(context: SalesforceToolCallContext): Promise<ToolkitScope>;
    sdk: SalesforceSdk;
    loadRuntime(): Promise<ToolkitRuntime>;
  }) {}

  async catalog() {
    return { ok: true, provider: await this.deps.provider(), version: '0.2.0', tools: descriptions.map(({ name, description }) => ({ name, description })) };
  }
  async describe(name: string) {
    const item = descriptions.find(item => item.name === name);
    if (!item) return failure('unknown_tool', 'Use sf_tools list for supported tool names.');
    return { ok: true, ...structuredClone(item) };
  }

  async invoke(name: string, raw: unknown, context: SalesforceToolCallContext, resumeId?: string): Promise<any> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    context.signal?.addEventListener('abort', abort, { once: true });
    if (context.signal?.aborted) abort();
    let directory: string | undefined;
    let retained = false;
    try {
      if (this.disposed) return failure('unavailable', 'The toolkit adapter has stopped.');
      if (await this.deps.provider() === 'builtin') return failure('provider_disabled', 'Toolkit tools are disabled in Salesforce plugin settings.');
      if (this.active.size >= 4) return failure('busy', 'Four toolkit operations are already running.');
      this.active.add(controller);
      controller.signal.throwIfAborted();
      const description = descriptions.find(item => item.name === name);
      if (!description) return failure('unknown_tool', 'Use sf_tools list for supported tool names.');
      const scope = await this.deps.scope(context);
      const workspace = await realpath(scope.workspace);
      const preliminary = await prepareToolkitInput(name, raw, workspace, scope.orgAlias || null);
      const local = isLocalToolkitCall(name, preliminary);
      if (!local && !scope.orgAlias) return failure('org_required', 'Select an org for this project with sf_workbench context.select.');
      const org = local ? null : await this.deps.sdk.connect({ alias: scope.orgAlias });
      // Pin the username rather than an alias which could be rebound during approval.
      const input: Record<string, any> = { ...preliminary, ...(org ? { target_org: org.username } : {}) };
      const saved = resumeId ? this.runs.get(resumeId) : undefined;
      if (resumeId && (!saved || saved.projectId !== scope.projectId || saved.workspace !== workspace || saved.org !== (org?.orgId ?? null))) return failure('scope_mismatch', 'Resume belongs to another project/org or has expired.');
      const effects = toolkitRequiresApproval(description, input);
      const fingerprint = createHash('sha256').update(JSON.stringify({ name, input, workspace, orgId: org?.orgId ?? null, resumeId })).digest('hex');
      const summary = `${name} ${String(input.action ?? input.verb)} in ${scope.projectId}${org ? ` on ${org.alias}` : ' (local project)'}`;
      const decision = await this.deps.sdk.confirm({
        ...(effects ? { kind: 'org.write' as const } : {}),
        orgAlias: org?.alias ?? '(local project)', orgId: org?.orgId, orgKind: org?.kind ?? 'sandbox',
        summary, fingerprint, preview: JSON.stringify(redactToolkitResult(input)).slice(0, 8_000)
      }, context.threadId ?? '');
      if (!decision.approved) return failure('refused', `Operator ${decision.reason} ${summary}.`);
      controller.signal.throwIfAborted();
      // A mode change cannot turn an already-approved operation into a hidden provider call.
      if (await this.deps.provider() === 'builtin') return failure('provider_disabled', 'Toolkit tools were disabled while this operation was being approved.');
      const current = await this.deps.scope(context);
      if (current.projectId !== scope.projectId || await realpath(current.workspace) !== workspace || current.orgAlias !== scope.orgAlias) return failure('scope_mismatch', 'Project/org changed while approving. Run the operation again.');
      await prepareToolkitInput(name, preliminary, workspace, scope.orgAlias || null);
      const runtime = await this.deps.loadRuntime();
      this.root ??= mkdtemp(join(tmpdir(), 'zcc-salesforce-tools-'));
      const root = await this.root;
      controller.signal.throwIfAborted();
      directory = await mkdtemp(join(root, 'call-'));
      const result = await runtime.executeTool(name, input, {
        workspace, artifactDir: directory, timeoutMs: 120_000, signal: controller.signal,
        allowEffects: effects && decision.approved, ...(saved ? { resume: saved.runFile } : {})
      });
      controller.signal.throwIfAborted();
      await checkEvidenceSize(directory);
      if (result.execution) {
        const runFile = await confinedToolkitPath(directory, result.execution.runFile);
        const resultFile = await confinedToolkitPath(directory, result.execution.resultFile);
        const id = result.execution.runId;
        if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid toolkit run identity.');
        this.runs.set(id, { projectId: scope.projectId, workspace, org: org?.orgId ?? null, runFile, resultFile, directory });
        retained = true;
      }
      const projected = redactToolkitResult(runtime.toModelResult(result, { maxBytes: 24_000 }));
      if (projected.execution) projected.execution = { runId: result.execution.runId };
      return projected;
    } catch (error) {
      return failure(controller.signal.aborted ? 'interrupted' : 'toolkit_failed', error instanceof Error ? error.message : 'Toolkit operation failed.');
    } finally {
      this.active.delete(controller); context.signal?.removeEventListener('abort', abort);
      if (directory && (!retained || this.disposed)) await rm(directory, { recursive: true, force: true });
      // Never delete a resume directory while another invocation might be using it.
      if (!this.active.size) while (this.runs.size > 32) {
        const id = this.runs.keys().next().value!;
        const old = this.runs.get(id)!; this.runs.delete(id);
        await rm(old.directory, { recursive: true, force: true });
      }
    }
  }

  async read(runId: string, context: SalesforceToolCallContext, selection: { pointer?: string; offset?: number; limit?: number } = {}): Promise<any> {
    try {
      if (this.disposed || await this.deps.provider() === 'builtin') return failure('provider_disabled', 'Toolkit results are unavailable in the current provider mode.');
      const scope = await this.deps.scope(context);
      const saved = this.runs.get(runId);
      if (!saved || saved.projectId !== scope.projectId || saved.workspace !== await realpath(scope.workspace)) return failure('scope_mismatch', 'Result belongs to another project or has expired.');
      const org = saved.org ? await this.deps.sdk.connect({ alias: scope.orgAlias }) : null;
      if (saved.org !== (org?.orgId ?? null)) return failure('scope_mismatch', 'Result belongs to another org.');
      if (org) {
        const decision = await this.deps.sdk.confirm({ orgAlias: org.alias, orgId: org.orgId, orgKind: org.kind, summary: 'Read saved toolkit evidence' }, context.threadId ?? '');
        if (!decision.approved) return failure('refused', 'Saved evidence access refused.');
      }
      const bounded = { ...selection, ...(selection.limit !== undefined || selection.offset !== undefined ? { limit: Math.min(Math.max(Number.isFinite(selection.limit) ? selection.limit! : 20, 1), 100) } : {}) };
      return redactToolkitResult(await (await this.deps.loadRuntime()).readResult(saved.resultFile, bounded));
    } catch (error) { return failure('toolkit_failed', error instanceof Error ? error.message : 'Result lookup failed.'); }
  }

  async dispose() {
    this.disposed = true;
    this.cancelActive();
    this.runs.clear();
    if (this.root) await rm(await this.root, { recursive: true, force: true });
  }
  cancelActive() { for (const controller of this.active) controller.abort(); }
}

async function checkEvidenceSize(directory: string) {
  let bytes = 0, files = 0;
  async function visit(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (++files > 256 || (await lstat(file)).isSymbolicLink()) throw Error('Toolkit evidence exceeds its file limit or contains a symlink.');
      if (entry.isDirectory()) await visit(file);
      else { bytes += (await lstat(file)).size; if (bytes > 32 * 1024 * 1024) throw Error('Toolkit evidence exceeds 32 MiB.'); }
    }
  }
  await visit(directory);
}

export function toolkitNativeSchema(name: string): Record<string, any> {
  const schema = structuredClone(descriptions.find(item => item.name === name)!.inputSchema);
  delete schema.properties.target_org; delete schema.properties.workspace;
  schema.properties.resumeId = { type: 'string', description: 'Host-owned run ID returned by a previous call.' };
  return schema;
}
function failure(code: string, error: string) { return { ok: false, code, error }; }
