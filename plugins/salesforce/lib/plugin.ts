import { join } from 'node:path';
import { WorkbenchResults } from './workbench-results.js';
import { WORKBENCH_ACTIONS, actionCatalog, actionInput, actionParameters, isWorkbenchAction, workbenchActionNames } from './workbench-actions.js';
import { WorkbenchControl } from './workbench-control.js';
import { createAgentDraft, draftDestination, DRAFT_PROJECT } from './agent-drafts.js';
import type { AgentDraftInput } from './agent-draft-contract.js';
import type { PluginAgentToolContext, PluginInteractionResult, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { randomUUID } from 'node:crypto';
import {
  activateArgs,
  agentCliOpts,
  BOT_VERSION_SOQL,
  canActivate,
  compactPreviewDigest,
  diagnoseAgentBundle,
  evalCaseCount,
  EVAL_POLL_INTERVAL_MS,
  EVAL_POLL_MAX_ATTEMPTS,
  EVAL_RUNS_PATH,
  evalResultsPath,
  evalRunPath,
  evalRunStatus,
  EvalEvidenceStore,
  extractEvalBotVersionId,
  extractEvalRunId,
  extractSessionId,
  findAgentBundle,
  isEvalTerminal,
  parseAgentInput,
  parseSfJson,
  previewArgs,
  probeAgentCapabilities,
  publishArgs,
  resolveAgentCompilerBin,
  runEvalArgs,
  scanAgentBundles,
  specFingerprint,
  summarizeEvalRun,
  validateArgs,
  type AgentPlan,
  type AgentPreviewIdentity
} from './agent.js';
import { diagnoseApexSource, parseApexInput } from './apex.js';
import { createKvArtifactStore, type ArtifactStore } from './artifacts.js';
import { CONSTITUTION_INSTRUCTIONS, shouldContributeConstitution } from './constitution.js';
import { ConnectionError, ConnectionManager } from './connection.js';
import { AgentforceLab } from './agentforce-lab.js';
import type { AgentforceTransport } from './agentforce-transport.js';
import { formatDoctor } from './doctor.js';
import { createSalesforceSdk } from './sdk.js';
import { WorkbenchService } from './workbench-service.js';
import { ProjectContexts, ProjectContextError } from './project-context.js';
import type { SalesforceSdk } from './sdk-contract.js';
import { compactError, fingerprint, isDxProject, resolveUnderRoot } from './dx-project.js';
import { generatedOutputPath, parseGenerateInput } from './project-generate.js';
import {
  AgentFilesError,
  createAgentFile,
  listAgentFiles,
  readAgentFile,
  writeAgentFile
} from './agent-files.js';
import { parseAgentScriptSource } from './agent-script-parse.js';
import { readOrgAction, readProjectAction } from './action-source.js';
import { visualizeFlowSnapshot } from './flow-visualizer.js';
import { isAgentScriptLspQuery, queryAgentScriptLsp } from './agent-script-lsp.js';
import { AGENT_SCRIPT_EXAMPLES } from './agent-script-model.js';
import { envelopeTitle, Guardrail } from './guardrail.js';
import { diagnoseLwc, findLwcComponent, inspectLwc, parseLwcInput, resolveJestBin, scanLwcComponents } from './lwc.js';
import { createNodeDeps } from './node-deps.js';
import { formatOrgRoster, orgRosterInstructions } from './org-list.js';
import { OrgLoginService } from './org-login-service.js';
import { OrgAgentService } from './org-agent-service.js';
import { parseOrgLoginInput } from './org-login.js';
import { applyLimit, parseSoqlInput, previewRecords } from './soql.js';
import { SoqlExplorer } from './soql-explorer.js';
import {
  DEFAULT_API_VERSION,
  EVAL_API_VERSION,
  GUARDRAIL_RENDERER_ID,
  LOG_BODY_PREVIEW_CHARS,
  SETTING_API_VERSION,
  SETTING_AGENT_SCRIPT_DIALECT,
  SETTING_DEFAULT_ORG,
  SETTING_PROJECT_ROOT,
  AGENT_SCRIPT_DIALECTS,
  DEFAULT_AGENT_SCRIPT_DIALECT,
  normalizeAgentScriptDialect,
  type AgentScriptDialect,
  type DoctorReport,
  type EnvelopeKind,
  type PluginSettingsValues,
  type PublicOrgView,
  type SafetyEnvelope,
  type SalesforceDeps,
  type ToolResult
} from './types.js';

const SETTINGS = {
  [SETTING_DEFAULT_ORG]: {
    type: 'string' as const,
    label: 'Default org alias',
    description:
      'Salesforce CLI alias used by SOQL, Apex, LWC, and Agentforce. Pick from CLI-connected orgs in these settings or on the Salesforce tab. Blank falls back to SF_TARGET_ORG, then the CLI default.'
  },
  [SETTING_API_VERSION]: {
    type: 'string' as const,
    label: 'API version',
    description: 'REST/Tooling API version (no v prefix).',
    default: DEFAULT_API_VERSION
  },
  [SETTING_PROJECT_ROOT]: {
    type: 'string' as const,
    label: 'DX project root',
    description: 'Local Salesforce DX project path (the folder that contains sfdx-project.json). Used for LWC and Agentforce bundles.'
  },
  [SETTING_AGENT_SCRIPT_DIALECT]: {
    type: 'select' as const,
    label: 'Agentforce dialect',
    description: 'Parser and playground dialect for .agent files.',
    options: [...AGENT_SCRIPT_DIALECTS],
    default: DEFAULT_AGENT_SCRIPT_DIALECT
  }
};

function stringSetting(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function dialectSetting(value: unknown): AgentScriptDialect {
  return normalizeAgentScriptDialect(value);
}

export async function createSalesforcePlugin(zcc: ZccPluginApi, deps: SalesforceDeps = createNodeDeps(), labTransport?: AgentforceTransport): Promise<void> {
  const settings = zcc.settings.define(SETTINGS);
  const artifacts: ArtifactStore = createKvArtifactStore(zcc.storage.kv);
  const readSharedSettings = async (): Promise<PluginSettingsValues> => {
    const values = await settings.get();
    return {
      defaultOrg: stringSetting(values[SETTING_DEFAULT_ORG]),
      apiVersion: stringSetting(values[SETTING_API_VERSION]) || DEFAULT_API_VERSION,
      projectRoot: stringSetting(values[SETTING_PROJECT_ROOT]),
      agentScriptDialect: dialectSetting(values[SETTING_AGENT_SCRIPT_DIALECT])
    };
  };
  const readSettings = (): Promise<PluginSettingsValues> => contexts.settings();
  const connections = new ConnectionManager(deps, readSettings);
  const contexts = new ProjectContexts({
    settings: readSharedSettings,
    projects: () => zcc.sdk.projects.list(),
    resolveAlias: () => connections.resolveAlias(),
    kv: zcc.storage.kv,
    fs: deps
  });
  const rpcHandlers = new Map<string, (args: unknown) => unknown>();
  const registerRpc = (name: string, handler: (args: unknown) => unknown) => {
    rpcHandlers.set(name, handler);
    zcc.rpc.method(name, async (args) => {
      try { return await contexts.run(args, () => handler(args)); }
      catch (error) {
        return { ok: false, code: error instanceof ProjectContextError ? error.code : 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    });
  };
  const guardrail = new Guardrail(async (envelope, threadId) => confirmEnvelope(zcc, envelope, threadId));
  const evalEvidence = new EvalEvidenceStore(zcc.storage.kv);
  const lab = new AgentforceLab({
    transport: labTransport,
    connect: () => connections.connect(),
    scope: () => contexts.current()?.projectId ?? contexts.current()?.settings.projectRoot ?? 'global'
  });
  zcc.onDispose(() => lab.dispose());
  for (const method of ['start', 'send', 'next', 'evaluate', 'end'] as const) {
    registerRpc(`agentLab.${method}`, async (args) => ({ ok: true, data: await lab[method](args) }));
  }
  let lastDoctor: DoctorReport | null = null;
  const { sdk, emitOrgChange } = createSalesforceSdk({
    connections,
    guardrail,
    deps,
    readSettings
  });
  zcc.services.provide(sdk);
  const explorer = new SoqlExplorer(sdk, {
    get: <T>(key: string) => zcc.storage.kv.get<T>(contexts.key(key)),
    set: (key, value) => zcc.storage.kv.set(contexts.key(key), value)
  }, deps.now);
  registerRpc('context.select', async (args) => {
    const orgs = await sdk.listOrgs();
    await contexts.select(args, orgs.flatMap(org => [org.alias, org.username]));
    zcc.realtime.publish('context.changed', { projectId: contexts.current()?.projectId });
    return { ok: true };
  });

  const workbench = new WorkbenchService({
    sdk, contexts, fs: deps, kv: zcc.storage.kv,
    apex: (input, origin) => runApex(input, origin, sdk, artifacts, deps, readSettings),
    lwc: (input) => runLwc(input, deps, readSettings, artifacts)
  });
  registerRpc('records.get', args => workbench.record(args));
  registerRpc('logs.get', args => workbench.log(args));
  registerRpc('metadata.list', args => workbench.metadata(args));
  registerRpc('operations.list', () => workbench.list());
  registerRpc('operations.start', args => workbench.start(args));
  registerRpc('operations.report', args => workbench.report(args));
  registerRpc('apex.logs', args => runApex({ action: 'logs.fetch', limit: 20 }, { threadId: rpcString(args, 'threadId') }, sdk, artifacts, deps, readSettings));
  registerRpc('lwc.scan', () => runLwc({ action: 'scan' }, deps, readSettings, artifacts));
  zcc.onDispose(() => workbench.dispose());

  const resolveAgentFilesRoot = async (
    args: unknown
  ): Promise<{ root: string; options?: { allowNonDx?: boolean } }> => {
    const projectId = rpcString(args, 'projectId');
    if (projectId) {
      let projects: Array<{ id: string; path?: string }> = [];
      try {
        projects = await zcc.sdk.projects.list();
      } catch {
        throw new AgentFilesError('not_configured', 'Project list is not available.');
      }
      const match = projects.find((row) => row.id === projectId);
      if (!match) throw new AgentFilesError('not_found', `Project not found: ${projectId}`);
      if (!match.path?.trim()) {
        throw new AgentFilesError('not_configured', 'This project has no local folder to scan for .agent files.');
      }
      return { root: match.path, options: { allowNonDx: true } };
    }
    const snapshot = await readSettings();
    return { root: snapshot.projectRoot };
  };

  settings.onChange(() => {
    connections.invalidate();
    emitOrgChange();
  });

  registerRpc('doctor', async () => {
    const report = await sdk.doctor();
    if (!contexts.current()?.projectId && contexts.current()?.targetSource !== 'override') lastDoctor = report;
    return report;
  });
  const readStatus = async () => {
    const snapshot = await readSettings();
    const listed = await listOrgsSafe(sdk);
    return {
      projectId: contexts.current()?.projectId ?? null,
      projectName: contexts.current()?.projectName ?? null,
      targetSource: contexts.current()?.targetSource ?? 'shared',
      defaultOrg: snapshot.defaultOrg,
      selectedAlias: listed.selectedAlias,
      apiVersion: snapshot.apiVersion,
      projectRoot: snapshot.projectRoot,
      agentScriptDialect: snapshot.agentScriptDialect,
      dxProject: isDxProject(snapshot.projectRoot, deps.exists),
      lastDoctor: contexts.current()?.projectId ? null : lastDoctor,
      orgs: listed.orgs,
      orgsError: listed.error ?? null
    };
  };
  registerRpc('status', async (args) => {
    const input = args && typeof args === 'object' ? args as Record<string, unknown> : {};
    if (!input.projectId && typeof input.threadId === 'string' && input.threadId) {
      const thread = await zcc.sdk.threads.get({ threadId: input.threadId });
      if (!thread?.projectId) throw new ProjectContextError('The thread project is unavailable.');
      return contexts.run({ ...input, projectId: thread.projectId }, readStatus);
    }
    return readStatus();
  });
  registerRpc('orgs', async () => {
    try {
      const orgs = await sdk.listOrgs();
      const selectedAlias = await sdk.resolveAlias();
      return { ok: true, orgs, selectedAlias, targetSource: contexts.current()?.targetSource ?? 'shared' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof ConnectionError ? error.code : 'orgs_failed';
      return { ok: false, error: message, code, orgs: [], selectedAlias: null };
    }
  });
  const orgLogin = new OrgLoginService({
    execSf: deps.execSf,
    listOrgs: () => sdk.listOrgs(),
    invalidate: () => connections.invalidate(),
  });
  zcc.onDispose(() => orgLogin.dispose());
  const runOrgLogin = async (args: unknown) => {
    const context = contexts.current()!;
    let projectSelected: string | null = null;
    const result = await orgLogin.run(args, {
      cwd: context.settings.projectRoot || undefined,
      onConnected: context.projectId ? async (alias, orgs) => {
        await contexts.select({ projectId: context.projectId, selectedAlias: alias }, orgs.flatMap(org => [org.alias, org.username]));
        projectSelected = alias;
        zcc.realtime.publish('context.changed', { projectId: context.projectId });
      } : undefined,
    });
    if (!result.ok) return result;
    return { ...result, selectedAlias: projectSelected ?? await sdk.resolveAlias(), targetSource: projectSelected ? 'project' : context.targetSource };
  };
  registerRpc('orgs.login', runOrgLogin);
  // Human sign-in outlives the desktop RPC deadline. Keep only bounded, public
  // results and poll with short requests; AsyncLocalStorage pins the owner scope.
  const loginJobs = new Map<string, { projectId: string | null; result?: Awaited<ReturnType<typeof runOrgLogin>> }>();
  zcc.onDispose(() => loginJobs.clear());
  registerRpc('orgs.login.start', args => {
    const parsed = parseOrgLoginInput(args);
    if (!parsed.ok) return parsed;
    if ([...loginJobs.values()].some(job => !job.result)) return { ok: false, code: 'login_busy', error: 'Another org sign-in is in progress. Complete it in your browser, then retry.' };
    if (loginJobs.size >= 12) loginJobs.delete(loginJobs.keys().next().value!);
    const loginId = randomUUID();
    const job: { projectId: string | null; result?: Awaited<ReturnType<typeof runOrgLogin>> } = { projectId: contexts.current()!.projectId };
    loginJobs.set(loginId, job);
    void runOrgLogin(args).then(result => { job.result = result; }, () => {
      job.result = { ok: false, code: 'login_failed', error: 'Sign-in could not finish. Refresh the org list, then retry.' };
    });
    return { ok: true, loginId };
  });
  registerRpc('orgs.login.status', args => {
    const job = loginJobs.get(rpcString(args, 'loginId'));
    if (!job || job.projectId !== contexts.current()!.projectId) return { ok: false, error: 'This sign-in is no longer available. Refresh your orgs, then retry.' };
    return job.result ? { ok: true, done: true, result: job.result } : { ok: true, done: false };
  });
  registerRpc('project.generate', async (args) => {
    const parsed = parseGenerateInput(args);
    if (!parsed.ok) return { ok: false, code: parsed.code, error: parsed.error };
    const result = await sdk.execSf([
      'project',
      'generate',
      '--name',
      parsed.name,
      '--output-dir',
      parsed.outputDir,
      '--json'
    ]);
    if (result.code === 127) {
      return {
        ok: false,
        code: 'cli_missing',
        error: result.stderr.trim() || result.stdout.trim() || 'Salesforce CLI missing. Install sf, then retry.'
      };
    }
    const cli = parseSfJson(result.stdout);
    if (result.code !== 0 || cli.status !== 0) {
      return {
        ok: false,
        code: 'generate_failed',
        error:
          cli.message ||
          result.stderr.trim() ||
          result.stdout.trim() ||
          `sf project generate failed (${result.code})`
      };
    }
    return {
      ok: true,
      name: parsed.name,
      path: generatedOutputPath(cli.result, parsed.outputDir, parsed.name)
    };
  });
  let actionReads = 0;
  registerRpc('agentActions.source', async (args) => {
    if (actionReads >= 4) return { ok: false, error: 'Source previews are busy. Try again in a moment.' };
    actionReads++;
    try {
      const target = rpcString(args, 'target');
      const origin = rpcString(args, 'origin');
      if (origin !== 'project' && origin !== 'org') throw Error('Choose project or org source.');
      const snapshot = await readSettings();
      let sourceRoot = snapshot.projectRoot;
      if (origin === 'project' && sourceRoot && !contexts.current()?.projectId) {
        // A settings string alone cannot grant filesystem access. Global views
        // may use that folder only when it canonically matches a registered project.
        const projects = await zcc.sdk.projects.list();
        const registered = projects.some(project => {
          try { return project.path && deps.realpath(project.path) === deps.realpath(sourceRoot); }
          catch { return false; }
        });
        if (!registered) sourceRoot = '';
      }
      const data = origin === 'org'
        ? await readOrgAction(await connections.connect(), target, deps)
        : readProjectAction(sourceRoot, target, deps, rpcString(args, 'candidate') || undefined);
      if (args && typeof args === 'object' && 'visualize' in args && args.visualize === true && target.startsWith('flow://') && data.status === 'ready') {
        try { data.visualization = await visualizeFlowSnapshot(data); }
        catch (error) { data.visualizationError = error instanceof Error ? error.message : 'The Flow visualizer is unavailable.'; }
      }
      return { ok: true, data };
    } finally { actionReads--; }
  });
  const orgAgents = new OrgAgentService({ execSf: deps.execSf, connect: () => sdk.connect() });
  zcc.onDispose(() => orgAgents.dispose());
  registerRpc('agents.list', async () => ({ ok: true, data: await orgAgents.list() }));
  registerRpc('agents.draft.destination', async args => {
    const { root } = await resolveAgentFilesRoot(args);
    const { directory, initializesProject } = draftDestination(root);
    return { ok: true, directory, initializesProject };
  });
  registerRpc('agents.draft.create', async args => {
    const { root } = await resolveAgentFilesRoot(args);
    const file = createAgentDraft(root, args as AgentDraftInput);
    zcc.realtime.publish('files.changed', { projectId: contexts.current()?.projectId });
    return { ok: true, file };
  });
  registerRpc('agents.retrieve.start', async args => {
    const { root } = await resolveAgentFilesRoot(args);
    return { ok: true, ...await orgAgents.start(root, args) };
  });
  registerRpc('agents.retrieve.status', async args => {
    const { root } = await resolveAgentFilesRoot(args);
    return { ok: true, data: orgAgents.status(root, rpcString(args, 'jobId')) };
  });
  registerRpc('agents.retrieve.cancel', async args => {
    const { root } = await resolveAgentFilesRoot(args);
    orgAgents.cancel(root, rpcString(args, 'jobId'));
    return { ok: true };
  });
  registerRpc('agentFiles.list', async (args) => {
    try {
      const resolved = await resolveAgentFilesRoot(args);
      const preview = rpcString(args, 'purpose') === 'preview';
      const child = preview && !isDxProject(resolved.root, deps.exists) ? dxProjectRoot({ ...await readSettings(), projectRoot: resolved.root }, deps) : undefined;
      const files = listAgentFiles(child || resolved.root, deps, { ...resolved.options, bundlesOnly: preview });
      return { ok: true, files: child ? files.map(file => ({ ...file, path: `${DRAFT_PROJECT}/${file.path}` })) : files };
    } catch (error) {
      return agentFilesFailure(error);
    }
  });
  registerRpc('agentFiles.read', async (args) => {
    const path = rpcString(args, 'path');
    if (!path) return { ok: false, code: 'invalid_input', error: 'read requires path.' };
    try {
      const resolved = await resolveAgentFilesRoot(args);
      return { ok: true, file: readAgentFile(resolved.root, path, deps, resolved.options) };
    } catch (error) {
      return agentFilesFailure(error);
    }
  });
  registerRpc('agentFiles.create', async (args) => {
    const path = rpcString(args, 'path');
    const content = args && typeof args === 'object' ? (args as { content?: unknown }).content : undefined;
    if (!path || typeof content !== 'string') return { ok: false, code: 'invalid_input', error: 'Create requires a path and source.' };
    try {
      const resolved = await resolveAgentFilesRoot(args);
      return { ok: true, file: createAgentFile(resolved.root, path, content, deps, resolved.options) };
    } catch (error) { return agentFilesFailure(error); }
  });
  registerRpc('agentFiles.write', async (args) => {
    const path = rpcString(args, 'path');
    const content = args && typeof args === 'object' && 'content' in args ? (args as { content?: unknown }).content : undefined;
    const expectedSha256 = rpcString(args, 'expectedSha256') || undefined;
    if (!path || typeof content !== 'string') {
      return { ok: false, code: 'invalid_input', error: 'write requires path and string content.' };
    }
    try {
      const resolved = await resolveAgentFilesRoot(args);
      return { ok: true, file: writeAgentFile(resolved.root, path, content, deps, expectedSha256, resolved.options) };
    } catch (error) {
      return agentFilesFailure(error);
    }
  });
  registerRpc('agentScript.parse', async (args) => {
    const snapshot = await readSettings();
    const source = args && typeof args === 'object' && typeof (args as { source?: unknown }).source === 'string'
      ? (args as { source: string }).source
      : '';
    const dialect = dialectSetting(
      args && typeof args === 'object' && 'dialect' in args
        ? (args as { dialect?: unknown }).dialect
        : snapshot.agentScriptDialect
    );
    return { ok: true, result: parseAgentScriptSource(source, dialect) };
  });
  registerRpc('agentScript.query', async (args) => {
    const snapshot = await readSettings();
    const source = args && typeof args === 'object' && typeof (args as { source?: unknown }).source === 'string'
      ? (args as { source: string }).source
      : '';
    const dialect = dialectSetting(
      args && typeof args === 'object' && 'dialect' in args
        ? (args as { dialect?: unknown }).dialect
        : snapshot.agentScriptDialect
    );
    const query = args && typeof args === 'object' && 'query' in args ? (args as { query?: unknown }).query : undefined;
    const line = args && typeof args === 'object' && 'line' in args ? (args as { line?: unknown }).line : undefined;
    const column = args && typeof args === 'object' && 'column' in args ? (args as { column?: unknown }).column : undefined;
    const result = queryAgentScriptLsp({
      source,
      dialect,
      ...(isAgentScriptLspQuery(query) ? { query } : {}),
      line: typeof line === 'number' ? line : undefined,
      column: typeof column === 'number' ? column : undefined
    });
    return result.ok ? { ok: true, result: result.result } : { ok: false, error: result.error };
  });
  registerRpc('agentScript.examples', async () => ({ ok: true, examples: AGENT_SCRIPT_EXAMPLES }));
  registerRpc('agentPreview.start', (args) =>
    runUiPreview('preview.start', args, sdk, artifacts, deps, readSettings)
  );
  registerRpc('agentPreview.send', (args) =>
    runUiPreview('preview.send', args, sdk, artifacts, deps, readSettings)
  );
  registerRpc('agentPreview.end', (args) =>
    runUiPreview('preview.end', args, sdk, artifacts, deps, readSettings)
  );
  registerRpc('org', async () => {
    try {
      const org = await sdk.connect();
      return { ok: true, org };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof ConnectionError ? error.code : 'org_failed';
      return { ok: false, error: message, code };
    }
  });
  const soqlRpcs: Record<string, (args: unknown) => unknown> = {
    describeGlobal: (args) => explorer.describeGlobal(args),
    describeSObject: (args) => explorer.describeSObject(args),
    query: (args) => explorer.query(args),
    queryMore: (args) => explorer.queryMore(args),
    explain: (args) => explorer.explain(args),
    limits: () => explorer.limits(),
    abort: (args) => explorer.abort(args),
    'history.list': () => explorer.historyList(),
    'history.save': (args) => explorer.historySave(args),
    'history.remove': (args) => explorer.historyRemove(args)
  };
  for (const [name, handler] of Object.entries(soqlRpcs)) {
    // The workbench exposes read-only, paginated Salesforce APIs. It is usable
    // without an agent; agent tools independently mediate through runSoql.
    registerRpc(`soql.${name}`, handler);
    // Older bundles used the sql prefix.
    registerRpc(`sql.${name}`, handler);
  }
  zcc.onDispose(() => explorer.dispose());
  const queryResults = new WorkbenchResults();
  zcc.onDispose(() => queryResults.dispose());
  registerRpc('query.execute', async args => {
    const row = actionInput(args);
    const parsed = parseSoqlInput({ ...row, action: 'query.run' });
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const ctx = { projectId: contexts.current()?.projectId ?? '', threadId: rpcString(args, 'threadId'), signal: new AbortController().signal };
    const { org, mediated } = await mediateOrgRead(ctx, sdk, 'Run a query and display its result', parsed.plan.envelope);
    if (!mediated.approved) return { ok: false, code: 'refused', error: `Operator ${mediated.reason} query.` };
    const result = await explorer.query({ soql: applyLimit(parsed.plan.query!, Math.min(parsed.plan.limit, 200)), useToolingApi: row.useToolingApi === true, includeDeleted: parsed.plan.allRows });
    if (!result.ok) return result;
    const resultId = queryResults.put(ctx.projectId, org.orgId, result);
    return { ...result, resultId };
  });
  registerRpc('query.result', async args => ({ ok: true, result: queryResults.get(contexts.current()?.projectId ?? '', (await sdk.connect()).orgId, rpcString(args, 'resultId')) }));
  const control = new WorkbenchControl();
  zcc.onDispose(() => control.dispose());
  const controlScope = () => contexts.current()?.projectId ?? 'global';
  registerRpc('control.register', args => ({ ok: true, ...control.register(controlScope(), args, contexts.current()?.settings.defaultOrg ?? '') }));
  registerRpc('control.poll', args => { control.assertTarget(controlScope(), rpcString(args, 'viewId'), contexts.current()?.settings.defaultOrg ?? ''); return { ok: true, ...control.poll(controlScope(), args) }; });
  registerRpc('control.close', args => { control.close(controlScope(), rpcString(args, 'viewId')); return { ok: true }; });
  registerRpc('control.ack', args => ({ ok: true, ...control.acknowledge(controlScope(), args) }));
  registerRpc('control.views', () => ({ ok: true, views: control.list(controlScope()) }));
  registerRpc('control.command', args => ({ ok: true, ...control.request(controlScope(), args) }));
  registerRpc('control.result', args => ({ ok: true, ...control.result(controlScope(), rpcString(args, 'commandId')) }));

  const invokeAction = async (action: string, input: unknown, ctx: PluginAgentToolContext): Promise<unknown> => {
    try {
      if (action === 'capabilities') return { ok: true, actions: actionCatalog() };
      if (!ctx.projectId) return { ok: false, code: 'project_required', error: 'Choose a registered project for Salesforce actions.' };
      if (!isWorkbenchAction(action)) return { ok: false, code: 'invalid_input', error: 'Unknown Salesforce action. Use capabilities.' };
      const data = actionInput(input);
      if (action === 'files.write' && (typeof data.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.expectedSha256))) throw Error('Read the file first and supply its expectedSha256 revision.');
      if (action === 'project.create') {
        if (typeof data.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(data.name)) throw Error('Choose a simple project name.');
        data.outputDir = (await readSettings()).projectRoot;
        if (deps.exists(join(String(data.outputDir), data.name))) throw Error('That project folder already exists.');
      }
      if (action === 'ui.command') control.assertTarget(ctx.projectId, String(data.viewId), (await readSettings()).defaultOrg);
      const commandInput = data.input as Record<string, unknown> | undefined;
      const uiReadsOrg = action === 'ui.command' && (['object.select', 'record.open', 'log.open'].includes(String(data.command)) || (data.command === 'view.open' && commandInput?.view !== 'agentforce') || (data.command === 'panel.open' && ['agents', 'org-preview'].includes(String(commandInput?.tool))));
      const [method, policy] = WORKBENCH_ACTIONS[action];
      if (policy === 'org' || uiReadsOrg || (policy === 'conditional' && data.origin === 'org')) {
        const { mediated } = await mediateOrgRead(ctx, sdk, `Salesforce ${action}`);
        if (!mediated.approved) return { ok: false, code: 'refused', error: `Operator ${mediated.reason} ${action}.` };
      }
      const result = await rpcHandlers.get(method)!({ ...data, projectId: ctx.projectId, threadId: ctx.threadId });
      if (JSON.stringify(result).length > 750_000) throw Error('Result is too large. Narrow the selection.');
      return result;
    } catch (error) { return agentFilesFailure(error); }
  };
  const runFamily = (name: string, input: unknown, ctx: PluginAgentToolContext): Promise<unknown> => {
    const action = rpcString(input, 'action');
    if (isWorkbenchAction(action)) return invokeAction(action, (input as { input?: unknown }).input ?? input, ctx);
    if (name === 'sf_agent') return runAgent(input, ctx, sdk, artifacts, deps, readSettings, evalEvidence);
    if (name === 'sf_soql') return runSoql(input, ctx, sdk, artifacts);
    if (name === 'sf_apex') return runApex(input, ctx, sdk, artifacts, deps, readSettings);
    if (name === 'sf_lwc') return runLwc(input, deps, readSettings, artifacts);
    return Promise.resolve({ ok: false, error: 'Unknown Salesforce tool.' });
  };
  registerRpc('actions.run', args => invokeAction(rpcString(args, 'action'), (args as { input?: unknown })?.input, { projectId: contexts.current()?.projectId ?? '', threadId: rpcString(args, 'threadId'), signal: new AbortController().signal }));
  zcc.agents.registerTool({
    name: 'sf_workbench',
    description: 'Control the Salesforce project workbench. Use capabilities to discover semantic operations for local draft creation, org source retrieval, org selection, query history, deployment jobs and acknowledged UI controls. UI views are explicit and project-scoped. Local drafts work without an org.',
    parameters: { ...actionParameters, properties: { ...actionParameters.properties, action: { type: 'string', enum: ['capabilities', ...workbenchActionNames] } } },
    execute: (input, ctx) => contexts.run({ projectId: ctx.projectId }, () => invokeAction(rpcString(input, 'action'), (input as { input?: unknown })?.input, ctx)),
  });

  // Local authoring is available without a shared org. Connection readiness is
  // request/project-scoped and must not mark the entire plugin unavailable.

  zcc.cli.register({
    name: 'sf',
    summary: 'Salesforce DX doctor, org status, and Agentforce lint',
    commands: [
      { name: 'doctor', summary: 'Check Salesforce CLI, aliases, and the target org', usage: 'zcc sf doctor' },
      { name: 'org', summary: 'List CLI-connected orgs and the resolved target (no token)', usage: 'zcc sf org' },
      { name: 'action', summary: 'Run a scoped workbench action; capabilities lists actions', usage: 'zcc sf action <action> --input <JSON> --json' },
      { name: 'tool', summary: 'Run a Salesforce family tool with structured input', usage: 'zcc sf tool <sf_agent|sf_soql|sf_apex|sf_lwc> --input <JSON> --json' },
      { name: 'lint', summary: 'Lint a confined .agent file (or every bundle)', usage: 'zcc sf lint [path]' }
    ],
    async run(argv, cliContext) {
      const execute = async () => {
      const command = argv[0] ?? 'doctor';
      if (command === '--help' || command === '-h') {
        return { exitCode: 0, stdout: 'zcc sf doctor\nzcc sf org\nzcc sf lint [path]\nzcc sf action capabilities --json\nzcc sf action <action> --input <JSON> --json\nzcc sf tool <sf_agent|sf_soql|sf_apex|sf_lwc> --input <JSON> --json\n' };
      }
      if (command === 'action' || command === 'tool') {
        const inputIndex = argv.indexOf('--input');
        let input: unknown = {};
        try { input = inputIndex === -1 ? {} : JSON.parse(argv[inputIndex + 1] ?? ''); }
        catch { return { exitCode: 2, stderr: 'Provide valid JSON after --input.\n' }; }
        const ctx = { projectId: cliContext.projectId ?? '', threadId: cliContext.threadId ?? '', signal: cliContext.signal ?? new AbortController().signal };
        if (!ctx.projectId && argv[1] !== 'capabilities') return { exitCode: 2, stderr: 'Run in a registered project (or pass the ZCC project context).\n' };
        const result = command === 'action' ? await invokeAction(argv[1] ?? '', input, ctx) : await runFamily(argv[1] ?? '', actionInput(input), ctx);
        return { exitCode: (result as { ok?: boolean })?.ok === false ? 1 : 0, stdout: JSON.stringify(result) + '\n' };
      }
      const snapshot = await readSettings();
      if (command === 'doctor' || command === '') {
        lastDoctor = await sdk.doctor();
        return { exitCode: lastDoctor.cliOk ? 0 : 1, stdout: formatDoctor(lastDoctor) };
      }
      if (command === 'org') {
        let listed: Awaited<ReturnType<SalesforceSdk['listOrgs']>> = [];
        let selectedAlias: string | null = null;
        try {
          listed = await sdk.listOrgs();
          selectedAlias = await sdk.resolveAlias();
        } catch (error) {
          return {
            exitCode: 1,
            stderr: `${error instanceof Error ? error.message : String(error)}\n`
          };
        }
        const roster = `${formatOrgRoster(listed, selectedAlias)}\n`;
        try {
          const org = await sdk.connect();
          return {
            exitCode: 0,
            stdout: `${roster}Target: ${org.alias}  ${org.username}  ${org.kind}  ${org.instanceUrl}  api ${org.apiVersion}\n`
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (listed.length === 0) {
            return { exitCode: 1, stderr: `${message}\n` };
          }
          return { exitCode: 1, stdout: roster, stderr: `${message}\n` };
        }
      }
      if (command === 'lint') {
        return runAgentLint(deps, snapshot, argv.slice(1));
      }
      return { exitCode: 2, stderr: `unknown command: ${command}; run zcc sf --help\n` };
      };
      try { return await contexts.run({ projectId: cliContext.projectId }, execute); }
      catch (error) { return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` }; }
    }
  });

  zcc.agents.configure(async (ctx) => contexts.run({ projectId: ctx.projectId }, async () => {
    const snapshot = await readSettings();
    if (!shouldContributeConstitution({
      defaultOrg: contexts.current()?.targetSource === 'project' ? snapshot.defaultOrg : (await readSharedSettings()).defaultOrg,
      dxProject: isDxProject(snapshot.projectRoot, deps.exists)
    })) {
      return ctx.projectId ? { tools: ['sf_workbench', 'sf_agent'], instructions: 'Salesforce local authoring is available: use sf_workbench capabilities, then draft.create. Org actions require selecting a connected org.' } : {};
    }
    const listed = await listOrgsSafe(sdk);
    return {
      instructions: CONSTITUTION_INSTRUCTIONS + `\nSalesforce project target: ${snapshot.defaultOrg || 'not selected'}.\n` + orgRosterInstructions(listed.orgs, listed.selectedAlias),
      tools: ['sf_soql', 'sf_apex', 'sf_lwc', 'sf_agent', 'sf_workbench'],
      skills: ['salesforce-constitution', 'salesforce-dx']
    };
  }).catch(() => ({})));

  zcc.agents.registerTool({
    name: 'sf_soql',
    description:
      'Salesforce SOQL/SOSL lifecycle: schema search/describe, validate, bounded sample/run, and confined export. Prefer this over raw sf data query.',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'object', description: 'Additional workbench action fields' },
        action: { type: 'string', enum: ['schema.search', 'schema.describe', 'query.validate', 'query.sample', 'query.run', 'query.export', ...workbenchActionNames.filter(name => name.startsWith('query.') || name === 'records.get' || name === 'org.limits')] },
        query: { type: 'string' },
        sobject: { type: 'string' },
        term: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['action']
    },
    execute: (input, ctx) => contexts.run({ projectId: ctx.projectId }, () => runFamily('sf_soql', input, ctx))
  });

  zcc.agents.registerTool({
    name: 'sf_apex',
    description:
      'Salesforce Apex lifecycle: local diagnose, targeted tests, debug logs, and anonymous Apex. Source edits stay with file tools. Anonymous Apex always confirms.',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'object', description: 'Additional workbench action fields' },
        action: { type: 'string', enum: ['diagnose', 'test.run', 'logs.fetch', 'anon.run', 'logs.get'] },
        className: { type: 'string' },
        methodNames: { type: 'array', items: { type: 'string' } },
        body: { type: 'string' },
        path: { type: 'string' },
        limit: { type: 'number' },
        allow_mutation: { type: 'boolean' }
      },
      required: ['action']
    },
    execute: (input, ctx) => contexts.run({ projectId: ctx.projectId }, () => runFamily('sf_apex', input, ctx))
  });

  zcc.agents.registerTool({
    name: 'sf_lwc',
    description:
      'Local Lightning Web Component scan, inspect, diagnose, and targeted Jest. No deploy, retrieve, preview, or create.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['scan', 'inspect', 'diagnose', 'test.jest'] },
        component: { type: 'string' },
        relativePath: { type: 'string' }
      },
      required: ['action']
    },
    execute: (input, ctx) => contexts.run({ projectId: ctx.projectId }, () => runLwc(input, deps, readSettings, artifacts))
  });

  zcc.agents.registerTool({
    name: 'sf_agent',
    description:
      'Agentforce lifecycle: LSP diagnose (diagnostics/hover/complete/definition/symbols) on a confined .agent file, compile/inspect, preview (simulate by default; live confirms), eval via a confined spec (sf agent test run-eval) or an org AiEvaluationDefinition, and fail-closed publish/activate. Edit source in the Agentforce Playground side panel or file tools. Publish, activate, and live preview always confirm.',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'object', description: 'Fields for source, draft, files, studio and action operations; discover via sf_workbench capabilities' },
        action: {
          type: 'string',
          enum: [
            'compile',
            'inspect',
            'diagnose',
            'preview.start',
            'preview.send',
            'preview.end',
            'eval.run',
            'lifecycle.list',
            'lifecycle.publish',
            'lifecycle.activate',
            ...workbenchActionNames.filter(name => /^(source|draft|files|studio|actions)\./.test(name))
          ]
        },
        apiName: { type: 'string' },
        path: { type: 'string' },
        query: { type: 'string', enum: ['diagnostics', 'hover', 'complete', 'definition', 'symbols'] },
        line: { type: 'number' },
        column: { type: 'number' },
        sessionId: { type: 'string' },
        utterance: { type: 'string' },
        specPath: { type: 'string' },
        aiEvaluationDefinitionName: { type: 'string' },
        botVersionId: { type: 'string' },
        versionNumber: { type: 'number' },
        allow_untested: { type: 'boolean' },
        published: { type: 'boolean' },
        live: { type: 'boolean' }
      },
      required: ['action']
    },
    execute: (input, ctx) =>
      contexts.run({ projectId: ctx.projectId }, () => runFamily('sf_agent', input, ctx))
  });
}

async function confirmEnvelope(
  zcc: ZccPluginApi,
  envelope: SafetyEnvelope,
  threadId: string
): Promise<{ approved: boolean; reason: 'submitted' | 'cancelled' | 'headless' | 'denied' }> {
  if (!threadId) return { approved: false, reason: 'headless' };
  let result: PluginInteractionResult;
  try {
    result = await zcc.ui.requestInput({
      threadId,
      rendererId: GUARDRAIL_RENDERER_ID,
      title: envelopeTitle(envelope.kind),
      payload: {
        kind: envelope.kind,
        orgAlias: envelope.orgAlias,
        orgKind: envelope.orgKind,
        orgId: envelope.orgId ?? '',
        summary: envelope.summary,
        fingerprint: envelope.fingerprint ?? '',
        preview: envelope.preview ?? ''
      }
    });
  } catch {
    return { approved: false, reason: 'headless' };
  }
  if (result.outcome !== 'submitted') return { approved: false, reason: 'cancelled' };
  const value = result.value;
  const approved = Boolean(value && typeof value === 'object' && 'approved' in value && value.approved === true);
  return approved ? { approved: true, reason: 'submitted' } : { approved: false, reason: 'denied' };
}

function fail(code: string, error: string): ToolResult {
  return { ok: false, code, error };
}

async function runSoql(
  input: unknown,
  ctx: PluginAgentToolContext,
  sdk: SalesforceSdk,
  artifacts: ArtifactStore
): Promise<ToolResult> {
  const parsed = parseSoqlInput(input);
  if (!parsed.ok) return fail('invalid_input', parsed.error);
  try {
    if (parsed.plan.action === 'schema.search') {
      const org = await sdk.connect();
      const mediated = await sdk.confirm({
        orgAlias: org.alias,
        orgId: org.orgId,
        orgKind: org.kind,
        summary: `Describe global sObjects on ${org.alias} (${org.kind})`
      }, ctx.threadId);
      if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} schema.search.`);
      const { response } = await sdk.request('/sobjects', { method: 'GET' });
      if (response.status >= 400) return fail('api_error', compactError(response.status, response.json, response.text));
      const sobjects = Array.isArray((response.json as { sobjects?: unknown })?.sobjects)
        ? ((response.json as { sobjects: Array<{ name?: string; label?: string }> }).sobjects)
        : [];
      const term = (parsed.plan.term ?? '').toLowerCase();
      const hits = sobjects
        .filter((row) => `${row.name ?? ''} ${row.label ?? ''}`.toLowerCase().includes(term))
        .slice(0, 25)
        .map((row) => ({ name: row.name, label: row.label }));
      return { ok: true, summary: `${hits.length} sObject(s) matching ${JSON.stringify(parsed.plan.term)}`, data: hits };
    }
    if (parsed.plan.action === 'schema.describe') {
      const org = await sdk.connect();
      const mediated = await sdk.confirm({
        orgAlias: org.alias,
        orgId: org.orgId,
        orgKind: org.kind,
        summary: `Describe ${parsed.plan.sobject} on ${org.alias} (${org.kind})`
      }, ctx.threadId);
      if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} schema.describe.`);
      const { response } = await sdk.request(`/sobjects/${parsed.plan.sobject}/describe`, { method: 'GET' });
      if (response.status >= 400) return fail('api_error', compactError(response.status, response.json, response.text));
      const describe = response.json as { name?: string; fields?: Array<{ name?: string; type?: string; label?: string }> };
      const fields = (describe.fields ?? []).slice(0, 80).map((field) => ({
        name: field.name,
        type: field.type,
        label: field.label
      }));
      const artifactId = await artifacts.put('soql-describe', response.json);
      return {
        ok: true,
        summary: `${describe.name ?? parsed.plan.sobject}: ${fields.length} field(s) previewed`,
        data: { name: describe.name, fields },
        artifactId
      };
    }
    if (parsed.plan.action === 'query.validate') {
      return {
        ok: true,
        summary: parsed.plan.allRows
          ? 'Query parsed; ALL ROWS / unbounded execution requires confirmation.'
          : `Query parsed. Bounded run will use LIMIT ${parsed.plan.limit}.`,
        data: { allRows: parsed.plan.allRows, limit: parsed.plan.limit, unbounded: parsed.plan.unbounded }
      };
    }

    const query = applyLimit(parsed.plan.query ?? '', parsed.plan.limit);
    const org = await sdk.connect();
    const mediated = await sdk.confirm({
      orgAlias: org.alias,
      orgId: org.orgId,
      orgKind: org.kind,
      kind: parsed.plan.envelope,
      summary: `${parsed.plan.action} on ${org.alias} (${org.kind}): ${query.slice(0, 180)}`,
      fingerprint: fingerprint(query),
      preview: query.slice(0, 400)
    }, ctx.threadId);
    if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} ${parsed.plan.action}.`);
    const { response } = await sdk.request(parsed.plan.allRows ? '/queryAll' : '/query', {
      method: 'GET',
      query: { q: query }
    });
    if (response.status >= 400) return fail('api_error', compactError(response.status, response.json, response.text));
    const payload = response.json as { totalSize?: number; records?: unknown[] };
    const records = previewRecords(payload.records);
    const artifactId = await artifacts.put('soql-query', payload);
    return {
      ok: true,
      summary: `${payload.totalSize ?? records.length} row(s); showing ${records.length}`,
      data: { totalSize: payload.totalSize, records },
      artifactId
    };
  } catch (error) {
    return connectionFailure(error);
  }
}

async function runApex(
  input: unknown,
  ctx: Pick<PluginAgentToolContext, 'threadId'>,
  sdk: SalesforceSdk,
  artifacts: ArtifactStore,
  deps: SalesforceDeps,
  readSettings: () => Promise<PluginSettingsValues>
): Promise<ToolResult> {
  const parsed = parseApexInput(input);
  if (!parsed.ok) return fail('invalid_input', parsed.error);
  try {
    if (parsed.plan.action === 'diagnose') {
      const snapshot = await readSettings();
      const source = parsed.plan.path
        ? readConfinedFile(snapshot.projectRoot, parsed.plan.path, deps)
        : null;
      if (parsed.plan.path && !snapshot.projectRoot) {
        return fail('not_configured', 'Set DX project root to diagnose a local Apex path.');
      }
      if (parsed.plan.path && source === null) {
        return fail('path_refused', 'Apex path must stay inside the configured DX project root.');
      }
      const diagnosis = diagnoseApexSource(source ?? '', parsed.plan.className);
      return {
        ok: true,
        summary: `Local diagnose ${diagnosis.className ?? parsed.plan.className ?? 'Apex'} (${diagnosis.lines} lines)`,
        data: diagnosis
      };
    }

    if (parsed.plan.action === 'test.run') {
      const org = await sdk.connect();
      const mediated = await sdk.confirm({
        orgAlias: org.alias,
        orgId: org.orgId,
        orgKind: org.kind,
        summary: `Run Apex tests ${parsed.plan.className} on ${org.alias} (${org.kind})`
      }, ctx.threadId);
      if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} test.run.`);
      const { response } = await sdk.request('/tooling/runTestsSynchronous', {
        method: 'POST',
        body: {
          tests: [
            {
              className: parsed.plan.className,
              ...(parsed.plan.methodNames ? { testMethods: parsed.plan.methodNames } : {})
            }
          ]
        }
      });
      if (response.status >= 400) return fail('api_error', compactError(response.status, response.json, response.text));
      const artifactId = await artifacts.put('apex-tests', response.json);
      const summary = (response.json as { summaries?: Array<{ name?: string; outcome?: string }> })?.summaries;
      return {
        ok: true,
        summary: summary?.length
          ? summary.map((row) => `${row.name ?? parsed.plan.className}: ${row.outcome ?? 'ran'}`).join('; ')
          : `Targeted tests ran for ${parsed.plan.className}`,
        data: response.json,
        artifactId
      };
    }

    if (parsed.plan.action === 'logs.fetch') {
      const soql = `SELECT Id, StartTime, DurationMilliseconds, Status, Operation, LogLength FROM ApexLog ORDER BY StartTime DESC LIMIT ${parsed.plan.limit}`;
      const org = await sdk.connect();
      const mediated = await sdk.confirm({
        orgAlias: org.alias,
        orgId: org.orgId,
        orgKind: org.kind,
        summary: `Fetch Apex logs on ${org.alias} (${org.kind})`
      }, ctx.threadId);
      if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} logs.fetch.`);
      const { response } = await sdk.request('/tooling/query', { method: 'GET', query: { q: soql } });
      if (response.status >= 400) return fail('api_error', compactError(response.status, response.json, response.text));
      const records = ((response.json as { records?: Array<{ Id?: string }> }).records ?? []).slice(0, parsed.plan.limit);
      let bodyPreview: string | undefined;
      const firstId = records[0]?.Id;
      if (firstId) {
        const body = await sdk.request(`/tooling/sobjects/ApexLog/${firstId}/Body`, { method: 'GET' });
        bodyPreview = body.response.text.slice(0, LOG_BODY_PREVIEW_CHARS);
      }
      const artifactId = await artifacts.put('apex-logs', { records, bodyPreview });
      return {
        ok: true,
        summary: `${records.length} Apex log(s)`,
        data: { records, bodyPreview },
        artifactId
      };
    }

    const body = parsed.plan.body ?? '';
    const org = await sdk.connect();
    const mediated = await sdk.confirm({
      orgAlias: org.alias,
      orgId: org.orgId,
      orgKind: org.kind,
      kind: 'apex.anonymous',
      summary: `Anonymous Apex on ${org.alias} (${org.kind})${parsed.plan.mutationLikely ? ' — mutation-like tokens detected' : ''}${parsed.plan.allowMutation ? ' (allow_mutation intent)' : ''}`,
      fingerprint: fingerprint(`${org.orgId}:${body}`),
      preview: body.slice(0, 400)
    }, ctx.threadId);
    if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} anon.run.`);
    const { response } = await sdk.request('/tooling/executeAnonymous/', {
      method: 'GET',
      query: { anonymousBody: body }
    });
    if (response.status >= 400) return fail('api_error', compactError(response.status, response.json, response.text));
    const artifactId = await artifacts.put('apex-anon', response.json);
    const compiled = (response.json as { compiled?: boolean; success?: boolean; exceptionMessage?: string });
    return {
      ok: true,
      summary: compiled.success
        ? 'Anonymous Apex succeeded'
        : compiled.exceptionMessage || 'Anonymous Apex finished with errors',
      data: response.json,
      artifactId
    };
  } catch (error) {
    return connectionFailure(error);
  }
}

async function runLwc(
  input: unknown,
  deps: SalesforceDeps,
  readSettings: () => Promise<PluginSettingsValues>,
  artifacts: ArtifactStore
): Promise<ToolResult> {
  const parsed = parseLwcInput(input);
  if (!parsed.ok) return fail('invalid_input', parsed.error);
  const snapshot = await readSettings();
  if (!snapshot.projectRoot || !isDxProject(snapshot.projectRoot, deps.exists)) {
    return fail('not_configured', 'Set DX project root to a folder that contains sfdx-project.json.');
  }
  const projectRoot = deps.realpath(snapshot.projectRoot);
  const components = scanLwcComponents(projectRoot, deps);
  if (parsed.action === 'scan') {
    return {
      ok: true,
      summary: `${components.length} LWC bundle(s)`,
      data: components.map((row) => ({ name: row.name, dir: row.dir, hasJs: row.hasJs, hasHtml: row.hasHtml, hasMeta: row.hasMeta }))
    };
  }
  const component = findLwcComponent(components, parsed.component, parsed.relativePath);
  if (!component) return fail('not_found', `LWC component not found: ${parsed.component ?? parsed.relativePath}`);
  if (parsed.action === 'inspect') {
    return { ok: true, summary: `Inspected ${component.name}`, data: inspectLwc(component, deps) };
  }
  if (parsed.action === 'diagnose') {
    const issues = diagnoseLwc(component);
    return {
      ok: true,
      summary: issues.length === 0 ? `${component.name} looks structurally complete` : `${component.name}: ${issues.length} issue(s)`,
      data: { issues }
    };
  }
  const bin = resolveJestBin(projectRoot, deps);
  if (!bin) return fail('jest_missing', 'No contained sfdx-lwc-jest/lwc-jest binary under the DX project.');
  const result = await deps.spawnContained(bin, ['--', component.name], projectRoot);
  const artifactId = await artifacts.put('lwc-jest', { code: result.code, stdout: result.stdout, stderr: result.stderr });
  if (result.code !== 0) {
    return fail('jest_failed', `Jest failed for ${component.name} (${result.code}). Artifact ${artifactId}.`);
  }
  return {
    ok: true,
    summary: `Jest passed for ${component.name}`,
    data: { code: result.code, stdout: result.stdout.slice(0, 4000), stderr: result.stderr.slice(0, 2000) },
    artifactId
  };
}

async function runAgent(
  input: unknown,
  ctx: PluginAgentToolContext,
  sdk: SalesforceSdk,
  artifacts: ArtifactStore,
  deps: SalesforceDeps,
  readSettings: () => Promise<PluginSettingsValues>,
  evalEvidence: EvalEvidenceStore
): Promise<ToolResult> {
  const parsed = parseAgentInput(input);
  if (!parsed.ok) return fail('invalid_input', parsed.error);
  const snapshot = await readSettings();
  try {
    if (parsed.plan.action === 'compile' || parsed.plan.action === 'inspect') {
      return await runAgentLocal(parsed.plan, snapshot, sdk, deps);
    }
    if (parsed.plan.action === 'diagnose') {
      return await runAgentDiagnose(parsed.plan, snapshot, deps);
    }
    if (parsed.plan.action === 'eval.run') {
      return await runAgentEval(parsed.plan, ctx, sdk, artifacts, deps, snapshot, evalEvidence);
    }
    if (parsed.plan.action.startsWith('preview.')) {
      return await runAgentPreview(parsed.plan, ctx, sdk, artifacts, deps, snapshot);
    }
    if (parsed.plan.action === 'lifecycle.list') {
      return await runAgentList(ctx, sdk);
    }
    if (parsed.plan.action === 'lifecycle.publish') {
      return await runAgentPublish(parsed.plan, ctx, sdk, artifacts, deps, snapshot);
    }
    return await runAgentActivate(parsed.plan, ctx, sdk, artifacts, deps, snapshot, evalEvidence);
  } catch (error) {
    return connectionFailure(error);
  }
}

async function requireDxRoot(
  snapshot: PluginSettingsValues,
  deps: SalesforceDeps
): Promise<{ ok: true; projectRoot: string } | ToolResult> {
  const projectRoot = dxProjectRoot(snapshot, deps);
  if (!projectRoot) {
    return fail('not_configured', 'Set DX project root to a folder that contains sfdx-project.json.');
  }
  return { ok: true, projectRoot };
}

async function runAgentLocal(
  plan: AgentPlan,
  snapshot: PluginSettingsValues,
  sdk: SalesforceSdk,
  deps: SalesforceDeps
): Promise<ToolResult> {
  const loaded = await loadAgentBundles(plan, snapshot, deps);
  if (!('projectRoot' in loaded)) return loaded;
  if (plan.action === 'inspect' && !plan.apiName && !plan.path) {
    return {
      ok: true,
      summary: `${loaded.bundles.length} Agentforce bundle(s)`,
      data: loaded.bundles
    };
  }
  if (!loaded.bundle) return fail('not_found', `Agentforce bundle not found: ${plan.apiName ?? plan.path}`);
  if (plan.action === 'inspect') {
    const issues = diagnoseAgentBundle(loaded.bundle);
    return {
      ok: true,
      summary:
        issues.length === 0
          ? `${loaded.bundle.apiName} looks structurally complete`
          : `${loaded.bundle.apiName}: ${issues.length} issue(s)`,
      data: { ...loaded.bundle, issues }
    };
  }
  const probed = await probeAgentCapabilities(loaded.projectRoot, deps);
  if (probed.compiler === 'missing') {
    return fail(
      'compiler_missing',
      'No Agentforce compiler. Install the official compiler under the DX project node_modules or the sf agent plugin, then retry compile.'
    );
  }
  const bin = resolveAgentCompilerBin(loaded.projectRoot, deps);
  if (bin) {
    const result = await deps.spawnContained(bin, [loaded.bundle.path], loaded.projectRoot);
    if (result.code !== 0) {
      return fail('compile_failed', result.stderr.trim() || result.stdout.trim() || `compiler exited ${result.code}`);
    }
    return {
      ok: true,
      summary: `Compiled ${loaded.bundle.apiName} (library)`,
      data: { source: 'library', apiName: loaded.bundle.apiName }
    };
  }
  const alias = snapshot.defaultOrg.trim();
  if (!alias) {
    return fail('not_configured', 'Select an org on this project’s Salesforce tab to compile with sf agent validate. Local editing and diagnostics remain available.');
  }
  const result = await sdk.execSf(validateArgs(loaded.bundle.apiName, alias), agentCliOpts(loaded.projectRoot));
  const parsedCli = parseSfJson(result.stdout);
  const cliText = `${result.stdout}\n${result.stderr}`;
  if (result.code === 127 || /command agent not found|is not a sf command|unknown topic:? agent/i.test(cliText)) {
    return fail('compiler_missing', 'sf agent validate is not available.');
  }
  if (result.code !== 0 || parsedCli.status !== 0) {
    return fail(
      'compile_failed',
      parsedCli.message || result.stderr.trim() || result.stdout.trim() || `sf agent validate failed (${result.code})`
    );
  }
  return {
    ok: true,
    summary: `Compiled ${loaded.bundle.apiName} (cli)`,
    data: { source: 'cli', apiName: loaded.bundle.apiName, result: parsedCli.result }
  };
}

async function runAgentDiagnose(
  plan: AgentPlan,
  snapshot: PluginSettingsValues,
  deps: SalesforceDeps
): Promise<ToolResult> {
  try {
    const loaded = await loadAgentBundles(plan, snapshot, deps);
    if (!('projectRoot' in loaded)) return loaded;
    if (!loaded.bundle) return fail('not_found', `Agentforce bundle not found: ${plan.apiName ?? plan.path}`);
    const file = readAgentFile(loaded.projectRoot, loaded.bundle.path, deps);
    const queried = queryAgentScriptLsp({
      source: file.content,
      dialect: snapshot.agentScriptDialect,
      uri: `file://${file.path}`,
      query: plan.query ?? 'diagnostics',
      line: plan.line,
      column: plan.column
    });
    if (!queried.ok) return fail('invalid_input', queried.error);
    const result = queried.result;
    const query = result.query;
    const summary =
      query === 'hover'
        ? result.hover
          ? `${file.apiName}: hover`
          : `${file.apiName}: no hover`
        : query === 'complete'
          ? `${file.apiName}: ${result.completions?.length ?? 0} completion(s)`
          : query === 'definition'
            ? result.definition
              ? `${file.apiName}: definition`
              : `${file.apiName}: no definition`
            : query === 'symbols'
              ? `${file.apiName}: ${result.symbols?.length ?? 0} symbol(s)`
              : `${file.apiName}: ${result.diagnostics.length} diagnostic(s)`;
    return { ok: true, summary, data: { path: file.path, apiName: file.apiName, ...result } };
  } catch (error) {
    return agentFilesFailure(error);
  }
}

async function loadAgentBundles(
  plan: Pick<AgentPlan, 'apiName' | 'path'>,
  snapshot: PluginSettingsValues,
  deps: SalesforceDeps
): Promise<
  | { ok: true; projectRoot: string; bundles: ReturnType<typeof scanAgentBundles>; bundle: ReturnType<typeof findAgentBundle> }
  | ToolResult
> {
  const root = await requireDxRoot(snapshot, deps);
  if (!('projectRoot' in root)) return root;
  let sourcePath: string | null = null;
  if (plan.path) {
    sourcePath = resolveUnderRoot(snapshot.projectRoot, plan.path, deps.realpath);
    if (sourcePath && !resolveUnderRoot(root.projectRoot, sourcePath, deps.realpath)) return fail('path_refused', 'Select a source inside the Agentforce DX project.');
    if (!sourcePath) return fail('path_refused', 'Agentforce path must stay inside the configured DX project root.');
  }
  const bundles = scanAgentBundles(root.projectRoot, deps);
  // A supplied path identifies one exact source, even when other packages contain
  // the same basename. Never fall back to an API name after a missing path.
  const bundle = sourcePath
    ? bundles.find(row => row.path === sourcePath) ?? null
    : findAgentBundle(bundles, plan.apiName);
  if (bundle && plan.apiName && bundle.apiName !== plan.apiName) return fail('invalid_input', 'The API name does not match the selected Agentforce source.');
  return {
    ok: true,
    projectRoot: root.projectRoot,
    bundles,
    bundle
  };
}

async function mediateOrgRead(
  ctx: PluginAgentToolContext,
  sdk: SalesforceSdk,
  summary: string | ((org: PublicOrgView) => string),
  kind?: EnvelopeKind,
  extra?: { fingerprint?: string; preview?: string }
) {
  const org = await sdk.connect();
  const mediated = await sdk.confirm({
    orgAlias: org.alias,
    orgId: org.orgId,
    orgKind: org.kind,
    kind,
    summary: typeof summary === 'function' ? summary(org) : summary,
    fingerprint: extra?.fingerprint,
    preview: extra?.preview
  }, ctx.threadId);
  return { org, mediated };
}

async function runUiPreview(
  action: 'preview.start' | 'preview.send' | 'preview.end',
  args: unknown,
  sdk: SalesforceSdk,
  artifacts: ArtifactStore,
  deps: SalesforceDeps,
  readSettings: () => Promise<PluginSettingsValues>
): Promise<ToolResult> {
  const threadId = rpcString(args, 'threadId');
  const parsed = parseAgentInput({
    action,
    apiName: rpcString(args, 'apiName') || undefined,
    path: rpcString(args, 'path') || undefined,
    sessionId: rpcString(args, 'sessionId') || undefined,
    utterance:
      args && typeof args === 'object' && typeof (args as { utterance?: unknown }).utterance === 'string'
        ? (args as { utterance: string }).utterance
        : undefined,
    published: Boolean(args && typeof args === 'object' && (args as { published?: unknown }).published === true),
    live: Boolean(args && typeof args === 'object' && (args as { live?: unknown }).live === true)
  });
  if (!parsed.ok) return fail('invalid_input', parsed.error);
  const snapshot = await readSettings();
  const ctx: PluginAgentToolContext = {
    threadId,
    projectId: rpcString(args, 'projectId'),
    signal: new AbortController().signal
  };
  try {
    return await runAgentPreview(parsed.plan, ctx, sdk, artifacts, deps, snapshot);
  } catch (error) {
    return connectionFailure(error);
  }
}

async function runAgentPreview(
  plan: AgentPlan,
  ctx: PluginAgentToolContext,
  sdk: SalesforceSdk,
  artifacts: ArtifactStore,
  deps: SalesforceDeps,
  snapshot: PluginSettingsValues
): Promise<ToolResult> {
  const verb = plan.action === 'preview.start' ? 'start' : plan.action === 'preview.send' ? 'send' : 'end';
  const resolved = await resolvePreviewIdentity(plan, snapshot, deps, verb === 'start');
  if ('ok' in resolved) return resolved;
  const label = resolved.identity?.apiName ?? plan.sessionId ?? '';
  const live = plan.live || resolved.identity?.flag === 'api-name';
  const { org, mediated } = await mediateOrgRead(
    ctx,
    sdk,
    (connected) => `${live ? 'Live ' : ''}${plan.action} ${label} on ${connected.alias} (${connected.kind})`,
    live ? 'agent.preview.live' : undefined,
    { preview: label }
  );
  if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} ${plan.action}.`);
  const result = await sdk.execSf(
    previewArgs(verb, plan, org.alias, resolved.identity),
    agentCliOpts(resolved.projectRoot ?? dxProjectRoot(snapshot, deps))
  );
  const parsedCli = parseSfJson(result.stdout);
  if (result.code !== 0 || parsedCli.status !== 0) {
    return fail(
      'preview_failed',
      parsedCli.message || result.stderr.trim() || result.stdout.trim() || `sf agent preview ${verb} failed`
    );
  }
  const digest = compactPreviewDigest(parsedCli.result ?? parsedCli, plan.utterance);
  const sessionId = extractSessionId(parsedCli.result) ?? plan.sessionId ?? digest.sessionId;
  const artifactId = await artifacts.put('agent-preview', parsedCli.result ?? { stdout: result.stdout });
  return {
    ok: true,
    summary:
      verb === 'start'
        ? `Preview started${sessionId ? ` (${sessionId})` : ''}`
        : verb === 'end'
          ? 'Preview ended'
          : `Preview turn${digest.response ? `: ${String(digest.response).slice(0, 80)}` : ''}`,
    data: { ...digest, sessionId },
    artifactId
  };
}

async function runAgentEval(
  plan: AgentPlan,
  ctx: PluginAgentToolContext,
  sdk: SalesforceSdk,
  artifacts: ArtifactStore,
  deps: SalesforceDeps,
  snapshot: PluginSettingsValues,
  evalEvidence: EvalEvidenceStore
): Promise<ToolResult> {
  if (plan.specPath) {
    return runAgentEvalSpec(plan, ctx, sdk, artifacts, deps, snapshot, evalEvidence);
  }
  return runAgentEvalDefinition(plan, ctx, sdk, artifacts, deps, evalEvidence);
}

async function runAgentEvalSpec(
  plan: AgentPlan,
  ctx: PluginAgentToolContext,
  sdk: SalesforceSdk,
  artifacts: ArtifactStore,
  deps: SalesforceDeps,
  snapshot: PluginSettingsValues,
  evalEvidence: EvalEvidenceStore
): Promise<ToolResult> {
  const root = await requireDxRoot(snapshot, deps);
  if (!('projectRoot' in root)) return root;
  const specFile = resolveUnderRoot(snapshot.projectRoot, plan.specPath ?? '', deps.realpath);
  if (!specFile || !resolveUnderRoot(root.projectRoot, specFile, deps.realpath)) return fail('path_refused', 'Eval spec must stay inside the configured DX project root.');
  const specText = deps.readFile(specFile);
  if (specText === null) return fail('not_found', `Eval spec not found: ${plan.specPath}`);
  const { org, mediated } = await mediateOrgRead(
    ctx,
    sdk,
    (connected) => `eval.run ${plan.specPath} on ${connected.alias} (${connected.kind})`
  );
  if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} eval.run.`);
  const result = await sdk.execSf(runEvalArgs(specFile, org.alias), agentCliOpts(root.projectRoot));
  const parsedCli = parseSfJson(result.stdout);
  if (result.code !== 0 || parsedCli.status !== 0) {
    return fail(
      'eval_failed',
      parsedCli.message || result.stderr.trim() || result.stdout.trim() || 'sf agent test run-eval failed'
    );
  }
  const testCount = evalCaseCount(specText);
  const summary = summarizeEvalRun(parsedCli.result ?? parsedCli, testCount);
  const botVersionId = plan.botVersionId || extractEvalBotVersionId(parsedCli.result, plan.apiName);
  await evalEvidence.record({
    orgId: org.orgId,
    botVersionId,
    specFingerprint: specFingerprint(specText),
    passed: summary.passed,
    at: deps.now()
  });
  const artifactId = await artifacts.put('agent-eval', parsedCli.result ?? { stdout: result.stdout });
  return {
    ok: true,
    summary: summary.passed
      ? `Eval passed (${summary.passedCount}/${testCount || summary.passedCount}) for ${botVersionId}`
      : `Eval failed (${summary.failedCount} failure(s)) for ${botVersionId}`,
    data: { ...summary, botVersionId, orgId: org.orgId, testCount },
    artifactId
  };
}

async function runAgentEvalDefinition(
  plan: AgentPlan,
  ctx: PluginAgentToolContext,
  sdk: SalesforceSdk,
  artifacts: ArtifactStore,
  deps: SalesforceDeps,
  evalEvidence: EvalEvidenceStore
): Promise<ToolResult> {
  const definition = plan.aiEvaluationDefinitionName ?? '';
  const { org, mediated } = await mediateOrgRead(
    ctx,
    sdk,
    (connected) => `eval.run ${definition} on ${connected.alias} (${connected.kind})`
  );
  if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} eval.run.`);
  const created = await sdk.request(EVAL_RUNS_PATH, {
    method: 'POST',
    body: { aiEvaluationDefinitionName: definition },
    apiVersion: EVAL_API_VERSION
  });
  if (created.response.status >= 400) {
    return fail('api_error', compactError(created.response.status, created.response.json, created.response.text));
  }
  const runId = extractEvalRunId(created.response.json);
  if (!runId) {
    return fail('api_error', 'Eval run did not return a run id.');
  }
  const polled = await pollEvalRun(sdk, deps, runId);
  if (!polled.ok) return polled;
  const results = await sdk.request(evalResultsPath(runId), {
    method: 'GET',
    apiVersion: EVAL_API_VERSION
  });
  const payload = results.response.status < 400 ? results.response.json : polled.payload;
  if (results.response.status >= 400 && !polled.payload) {
    return fail('api_error', compactError(results.response.status, results.response.json, results.response.text));
  }
  const summary = summarizeEvalRun(payload, 0);
  const botVersionId = plan.botVersionId || extractEvalBotVersionId(payload, plan.apiName || definition);
  await evalEvidence.record({
    orgId: org.orgId,
    botVersionId,
    specFingerprint: specFingerprint(definition),
    passed: summary.passed,
    at: deps.now()
  });
  const artifactId = await artifacts.put('agent-eval', payload);
  return {
    ok: true,
    summary: summary.passed
      ? `Eval passed (${summary.passedCount}) for ${botVersionId}`
      : `Eval failed (${summary.failedCount} failure(s)) for ${botVersionId}`,
    data: { ...summary, botVersionId, orgId: org.orgId, runId, definition },
    artifactId
  };
}

async function pollEvalRun(
  sdk: SalesforceSdk,
  deps: SalesforceDeps,
  runId: string
): Promise<{ ok: true; payload: unknown } | { ok: false; error: string; code: string }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let payload: unknown = null;
  for (let attempt = 0; attempt < EVAL_POLL_MAX_ATTEMPTS; attempt += 1) {
    const { response } = await sdk.request(evalRunPath(runId), {
      method: 'GET',
      apiVersion: EVAL_API_VERSION
    });
    if (response.status >= 400) {
      return { ok: false, code: 'api_error', error: compactError(response.status, response.json, response.text) };
    }
    payload = response.json;
    if (isEvalTerminal(evalRunStatus(payload))) {
      return { ok: true, payload };
    }
    if (attempt < EVAL_POLL_MAX_ATTEMPTS - 1) await sleep(EVAL_POLL_INTERVAL_MS);
  }
  return { ok: false, code: 'eval_timeout', error: `Eval run ${runId} did not complete.` };
}

async function runAgentList(
  ctx: PluginAgentToolContext,
  sdk: SalesforceSdk
): Promise<ToolResult> {
  const { mediated } = await mediateOrgRead(
    ctx,
    sdk,
    (org) => `lifecycle.list BotVersion on ${org.alias} (${org.kind})`
  );
  if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} lifecycle.list.`);
  const { response } = await sdk.request('/tooling/query', { method: 'GET', query: { q: BOT_VERSION_SOQL } });
  if (response.status >= 400) return fail('api_error', compactError(response.status, response.json, response.text));
  const records = ((response.json as { records?: unknown[] })?.records ?? []).slice(0, 25);
  return { ok: true, summary: `${records.length} BotVersion(s)`, data: { records } };
}

async function runAgentPublish(
  plan: AgentPlan,
  ctx: PluginAgentToolContext,
  sdk: SalesforceSdk,
  artifacts: ArtifactStore,
  deps: SalesforceDeps,
  snapshot: PluginSettingsValues
): Promise<ToolResult> {
  const loaded = await loadAgentBundles(plan, snapshot, deps);
  if (!('projectRoot' in loaded)) return loaded;
  const apiName = loaded.bundle?.apiName ?? plan.apiName;
  if (!apiName) return fail('invalid_input', 'lifecycle.publish requires apiName or path.');
  if (!loaded.bundle) return fail('not_found', `Agentforce bundle not found: ${plan.apiName ?? plan.path}`);
  const metadata = readConfinedFile(loaded.projectRoot, loaded.bundle.path.replace(/\.agent$/, '.bundle-meta.xml'), deps);
  if (metadata && /<target(?:\s|>)/.test(metadata)) return fail('versioned_source', 'Create a new local draft from this source before publishing a retrieved version.');
  const { org, mediated } = await mediateOrgRead(
    ctx,
    sdk,
    (connected) => `Publish inactive Agentforce version ${apiName} on ${connected.alias} (${connected.kind})`,
    'agent.publish',
    { preview: apiName }
  );
  if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} lifecycle.publish.`);
  const result = await sdk.execSf(publishArgs(apiName, org.alias), agentCliOpts(loaded.projectRoot));
  const parsedCli = parseSfJson(result.stdout);
  if (result.code !== 0 || parsedCli.status !== 0) {
    return fail(
      'publish_failed',
      parsedCli.message || result.stderr.trim() || result.stdout.trim() || 'sf agent publish failed'
    );
  }
  const artifactId = await artifacts.put('agent-publish', parsedCli.result ?? { stdout: result.stdout });
  return {
    ok: true,
    summary: `Published inactive version of ${apiName}`,
    data: parsedCli.result,
    artifactId
  };
}

async function runAgentActivate(
  plan: AgentPlan,
  ctx: PluginAgentToolContext,
  sdk: SalesforceSdk,
  artifacts: ArtifactStore,
  deps: SalesforceDeps,
  snapshot: PluginSettingsValues,
  evalEvidence: EvalEvidenceStore
): Promise<ToolResult> {
  const apiName = plan.apiName ?? '';
  const botVersionId = plan.botVersionId || (plan.versionNumber !== undefined ? String(plan.versionNumber) : apiName);
  if (!botVersionId) return fail('invalid_input', 'lifecycle.activate requires apiName or botVersionId.');
  const org = await sdk.connect();
  const gate = canActivate({
    evidence: await evalEvidence.get(org.orgId, botVersionId),
    orgId: org.orgId,
    botVersionId,
    allowUntested: plan.allowUntested
  });
  if (!gate.ok) return fail(gate.code, gate.error);
  const { mediated } = await mediateOrgRead(
    ctx,
    sdk,
    (connected) =>
      `Activate Agentforce ${apiName || botVersionId} (${gate.untested ? 'untested intent' : 'eval evidence'}) on ${connected.alias} (${connected.kind})`,
    'agent.activate',
    { preview: apiName || botVersionId }
  );
  if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} lifecycle.activate.`);
  const result = await sdk.execSf(
    activateArgs(apiName || botVersionId, org.alias, plan.versionNumber),
    agentCliOpts(dxProjectRoot(snapshot, deps))
  );
  const parsedCli = parseSfJson(result.stdout);
  if (result.code !== 0 || parsedCli.status !== 0) {
    return fail(
      'activate_failed',
      parsedCli.message || result.stderr.trim() || result.stdout.trim() || 'sf agent activate failed'
    );
  }
  const artifactId = await artifacts.put('agent-activate', parsedCli.result ?? { stdout: result.stdout });
  return {
    ok: true,
    summary: `Activated ${apiName || botVersionId}`,
    data: parsedCli.result,
    artifactId
  };
}

function dxProjectRoot(snapshot: PluginSettingsValues, deps: SalesforceDeps): string | undefined {
  if (!snapshot.projectRoot.trim()) return undefined;
  if (isDxProject(snapshot.projectRoot, deps.exists)) return deps.realpath(snapshot.projectRoot);
  const child = resolveUnderRoot(snapshot.projectRoot, DRAFT_PROJECT, deps.realpath);
  return child && isDxProject(child, deps.exists) ? child : undefined;
}

async function resolvePreviewIdentity(
  plan: AgentPlan,
  snapshot: PluginSettingsValues,
  deps: SalesforceDeps,
  requireIdentity: boolean
): Promise<{ identity?: AgentPreviewIdentity; projectRoot?: string } | ToolResult> {
  if (plan.published) {
    const apiName = plan.apiName;
    if (!apiName) return fail('invalid_input', 'published preview requires apiName.');
    return { identity: { flag: 'api-name', apiName }, projectRoot: dxProjectRoot(snapshot, deps) };
  }
  if (plan.path) {
    const loaded = await loadAgentBundles(plan, snapshot, deps);
    if (!('projectRoot' in loaded)) return loaded;
    if (!loaded.bundle) return fail('not_found', `Agentforce bundle not found: ${plan.path}`);
    return {
      identity: { flag: 'authoring-bundle', apiName: loaded.bundle.apiName },
      projectRoot: loaded.projectRoot
    };
  }
  if (plan.apiName) {
    const projectRoot = dxProjectRoot(snapshot, deps);
    if (projectRoot) {
      const bundle = findAgentBundle(scanAgentBundles(projectRoot, deps), plan.apiName);
      if (bundle) {
        return { identity: { flag: 'authoring-bundle', apiName: bundle.apiName }, projectRoot };
      }
    }
    return { identity: { flag: 'api-name', apiName: plan.apiName }, projectRoot };
  }
  if (requireIdentity) return fail('invalid_input', 'preview.start requires apiName or path.');
  return { projectRoot: dxProjectRoot(snapshot, deps) };
}

function readConfinedFile(projectRoot: string, relativePath: string, deps: SalesforceDeps): string | null {
  if (!projectRoot.trim()) return null;
  const resolved = resolveUnderRoot(projectRoot, relativePath, deps.realpath);
  if (!resolved) return null;
  return deps.readFile(resolved);
}

async function listOrgsSafe(
  sdk: SalesforceSdk
): Promise<{ orgs: Awaited<ReturnType<SalesforceSdk['listOrgs']>>; selectedAlias: string | null; error?: string }> {
  try {
    const orgs = await sdk.listOrgs();
    const selectedAlias = await sdk.resolveAlias();
    return { orgs, selectedAlias };
  } catch (error) {
    return { orgs: [], selectedAlias: null, error: error instanceof ConnectionError && error.code === 'cli_missing'
      ? 'Salesforce CLI (sf) was not found on PATH. Install it, then check again.'
      : 'Could not read Salesforce CLI connections. Check the CLI, then try again.' };
  }
}

function rpcString(args: unknown, key: string): string {
  if (!args || typeof args !== 'object') return '';
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function agentFilesFailure(error: unknown): { ok: false; code: string; error: string } {
  if (error instanceof AgentFilesError) return { ok: false, code: error.code, error: error.message };
  return { ok: false, code: 'failed', error: error instanceof Error ? error.message : String(error) };
}

function runAgentLint(
  deps: SalesforceDeps,
  snapshot: PluginSettingsValues,
  argv: string[]
): { exitCode: number; stdout?: string; stderr?: string } {
  const target = argv[0]?.trim() ?? '';
  try {
    const files = target
      ? [readAgentFile(snapshot.projectRoot, target, deps, { allowNonDx: true })]
      : listAgentFiles(snapshot.projectRoot, deps, { allowNonDx: true }).map((row) => readAgentFile(snapshot.projectRoot, row.path, deps, { allowNonDx: true }));
    if (files.length === 0) {
      return { exitCode: 0, stdout: 'No Agentforce sources in this project.\n' };
    }
    let failed = 0;
    const lines: string[] = [];
    for (const file of files) {
      const parsed = parseAgentScriptSource(file.content, snapshot.agentScriptDialect);
      const errors = parsed.diagnostics.filter((row) => row.severity === 'error');
      if (errors.length === 0 && !parsed.hasErrors) {
        lines.push(`${file.path}: ok (${parsed.graph.nodes.length} nodes)`);
        continue;
      }
      failed += 1;
      lines.push(`${file.path}: ${errors.length || parsed.diagnostics.length} issue(s)`);
      for (const diagnostic of parsed.diagnostics.slice(0, 20)) {
        lines.push(`  ${diagnostic.line + 1}:${diagnostic.column + 1} ${diagnostic.severity} ${diagnostic.message}`);
      }
    }
    return { exitCode: failed === 0 ? 0 : 1, stdout: `${lines.join('\n')}\n` };
  } catch (error) {
    const failure = agentFilesFailure(error);
    return { exitCode: 1, stderr: `${failure.error}\n` };
  }
}

function connectionFailure(error: unknown): ToolResult {
  if (error instanceof ConnectionError) return fail(error.code, error.message);
  return fail('failed', error instanceof Error ? error.message : String(error));
}
