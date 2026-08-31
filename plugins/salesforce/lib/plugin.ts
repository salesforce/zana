import type { PluginAgentToolContext, PluginInteractionResult, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
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
import { formatDoctor, runDoctor } from './doctor.js';
import { compactError, fingerprint, isDxProject, resolveUnderRoot } from './dx-project.js';
import {
  AgentFilesError,
  listAgentFiles,
  readAgentFile,
  writeAgentFile
} from './agent-files.js';
import { parseAgentScriptSource } from './agent-script-parse.js';
import { AGENT_SCRIPT_EXAMPLES } from './agent-script-model.js';
import { envelopeTitle, Guardrail } from './guardrail.js';
import { diagnoseLwc, findLwcComponent, inspectLwc, parseLwcInput, resolveJestBin, scanLwcComponents } from './lwc.js';
import { createNodeDeps } from './node-deps.js';
import { publicOrgView } from './org-resolution.js';
import { applyLimit, parseSoqlInput, previewRecords } from './soql.js';
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
  type ResolvedOrg,
  type SafetyEnvelope,
  type SalesforceDeps,
  type ToolFailure,
  type ToolResult
} from './types.js';

const SETTINGS = {
  [SETTING_DEFAULT_ORG]: {
    type: 'string' as const,
    label: 'Default org alias',
    description: 'Salesforce CLI alias used by family tools. Blank falls back to SF_TARGET_ORG, then the CLI default.'
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
    description: 'Local Salesforce DX project path (the folder that contains sfdx-project.json). Used for LWC and Agent Script bundles.'
  },
  [SETTING_AGENT_SCRIPT_DIALECT]: {
    type: 'select' as const,
    label: 'Agent Script dialect',
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

export async function createSalesforcePlugin(zcc: ZccPluginApi, deps: SalesforceDeps = createNodeDeps()): Promise<void> {
  const settings = zcc.settings.define(SETTINGS);
  const artifacts: ArtifactStore = createKvArtifactStore(zcc.storage.kv);
  const connections = new ConnectionManager(deps, async () => {
    const values = await settings.get();
    return {
      defaultOrg: stringSetting(values[SETTING_DEFAULT_ORG]),
      apiVersion: stringSetting(values[SETTING_API_VERSION]) || DEFAULT_API_VERSION
    };
  });
  const guardrail = new Guardrail(async (envelope, threadId) => confirmEnvelope(zcc, envelope, threadId));
  const evalEvidence = new EvalEvidenceStore(zcc.storage.kv);
  let lastDoctor: DoctorReport | null = null;

  const readSettings = async (): Promise<PluginSettingsValues> => {
    const values = await settings.get();
    return {
      defaultOrg: stringSetting(values[SETTING_DEFAULT_ORG]),
      apiVersion: stringSetting(values[SETTING_API_VERSION]) || DEFAULT_API_VERSION,
      projectRoot: stringSetting(values[SETTING_PROJECT_ROOT]),
      agentScriptDialect: dialectSetting(values[SETTING_AGENT_SCRIPT_DIALECT])
    };
  };

  const applyStatus = async () => {
    const snapshot = await readSettings();
    if (!snapshot.defaultOrg) {
      zcc.status.needsConfiguration('Set a default org alias under Plugins → Salesforce, then run zcc sf doctor.');
    }
  };

  await applyStatus();
  settings.onChange(() => {
    connections.invalidate();
    void applyStatus();
  });

  zcc.rpc.method('doctor', async () => {
    const snapshot = await readSettings();
    lastDoctor = await runDoctor(deps, snapshot);
    return lastDoctor;
  });
  zcc.rpc.method('status', async () => {
    const snapshot = await readSettings();
    return {
      defaultOrg: snapshot.defaultOrg,
      apiVersion: snapshot.apiVersion,
      projectRoot: snapshot.projectRoot,
      agentScriptDialect: snapshot.agentScriptDialect,
      dxProject: isDxProject(snapshot.projectRoot, deps.exists),
      lastDoctor
    };
  });
  zcc.rpc.method('agentFiles.list', async () => {
    const snapshot = await readSettings();
    try {
      return { ok: true, files: listAgentFiles(snapshot.projectRoot, deps) };
    } catch (error) {
      return agentFilesFailure(error);
    }
  });
  zcc.rpc.method('agentFiles.read', async (args) => {
    const snapshot = await readSettings();
    const path = rpcString(args, 'path');
    if (!path) return { ok: false, code: 'invalid_input', error: 'read requires path.' };
    try {
      return { ok: true, file: readAgentFile(snapshot.projectRoot, path, deps) };
    } catch (error) {
      return agentFilesFailure(error);
    }
  });
  zcc.rpc.method('agentFiles.write', async (args) => {
    const snapshot = await readSettings();
    const path = rpcString(args, 'path');
    const content = args && typeof args === 'object' && 'content' in args ? (args as { content?: unknown }).content : undefined;
    const expectedSha256 = rpcString(args, 'expectedSha256') || undefined;
    if (!path || typeof content !== 'string') {
      return { ok: false, code: 'invalid_input', error: 'write requires path and string content.' };
    }
    try {
      return { ok: true, file: writeAgentFile(snapshot.projectRoot, path, content, deps, expectedSha256) };
    } catch (error) {
      return agentFilesFailure(error);
    }
  });
  zcc.rpc.method('agentScript.parse', async (args) => {
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
  zcc.rpc.method('agentScript.examples', async () => ({ ok: true, examples: AGENT_SCRIPT_EXAMPLES }));
  zcc.rpc.method('org', async () => {
    try {
      const org = publicOrgView(await connections.connect());
      return { ok: true, org };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof ConnectionError ? error.code : 'org_failed';
      return { ok: false, error: message, code };
    }
  });

  zcc.cli.register({
    name: 'sf',
    summary: 'Salesforce DX doctor, org status, and Agent Script lint',
    commands: [
      { name: 'doctor', summary: 'Check Salesforce CLI, aliases, and the target org', usage: 'zcc sf doctor' },
      { name: 'org', summary: 'Show the resolved target org (no token)', usage: 'zcc sf org' },
      { name: 'lint', summary: 'Lint a confined .agent file (or every bundle)', usage: 'zcc sf lint [path]' }
    ],
    async run(argv) {
      const command = argv[0] ?? 'doctor';
      if (command === '--help' || command === '-h') {
        return { exitCode: 0, stdout: 'zcc sf doctor\nzcc sf org\nzcc sf lint [path]\n' };
      }
      const snapshot = await readSettings();
      if (command === 'doctor' || command === '') {
        lastDoctor = await runDoctor(deps, snapshot);
        return { exitCode: lastDoctor.cliOk ? 0 : 1, stdout: formatDoctor(lastDoctor) };
      }
      if (command === 'org') {
        try {
          const org = publicOrgView(await connections.connect());
          return {
            exitCode: 0,
            stdout: `${org.alias}  ${org.username}  ${org.kind}  ${org.instanceUrl}  api ${org.apiVersion}\n`
          };
        } catch (error) {
          return {
            exitCode: 1,
            stderr: `${error instanceof Error ? error.message : String(error)}\n`
          };
        }
      }
      if (command === 'lint') {
        return runAgentLint(deps, snapshot, argv.slice(1));
      }
      return { exitCode: 2, stderr: `unknown command: ${command}; run zcc sf --help\n` };
    }
  });

  zcc.agents.configure(async () => {
    const snapshot = await readSettings();
    if (!shouldContributeConstitution({
      defaultOrg: snapshot.defaultOrg,
      dxProject: isDxProject(snapshot.projectRoot, deps.exists)
    })) {
      return {};
    }
    return {
      instructions: CONSTITUTION_INSTRUCTIONS,
      tools: ['sf_soql', 'sf_apex', 'sf_lwc', 'sf_agent'],
      skills: ['salesforce-constitution', 'salesforce-dx']
    };
  });

  zcc.agents.registerTool({
    name: 'sf_soql',
    description:
      'Salesforce SOQL/SOSL lifecycle: schema search/describe, validate, bounded sample/run, and confined export. Prefer this over raw sf data query.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['schema.search', 'schema.describe', 'query.validate', 'query.sample', 'query.run', 'query.export'] },
        query: { type: 'string' },
        sobject: { type: 'string' },
        term: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['action']
    },
    execute: (input, ctx) => runSoql(input, ctx, connections, guardrail, artifacts)
  });

  zcc.agents.registerTool({
    name: 'sf_apex',
    description:
      'Salesforce Apex lifecycle: local diagnose, targeted tests, debug logs, and anonymous Apex. Source edits stay with file tools. Anonymous Apex always confirms.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['diagnose', 'test.run', 'logs.fetch', 'anon.run'] },
        className: { type: 'string' },
        methodNames: { type: 'array', items: { type: 'string' } },
        body: { type: 'string' },
        path: { type: 'string' },
        limit: { type: 'number' },
        allow_mutation: { type: 'boolean' }
      },
      required: ['action']
    },
    execute: (input, ctx) => runApex(input, ctx, connections, guardrail, artifacts, deps, readSettings)
  });

  zcc.agents.registerTool({
    name: 'sf_lwc',
    description:
      'Local Lightning Web Component scan, inspect, diagnose, and targeted Jest. No deploy, retrieve, preview, or create.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['scan', 'inspect', 'diagnose', 'test.jest'] },
        component: { type: 'string' },
        relativePath: { type: 'string' }
      },
      required: ['action']
    },
    execute: (input) => runLwc(input, deps, readSettings, artifacts)
  });

  zcc.agents.registerTool({
    name: 'sf_agent',
    description:
      'Agentforce Agent Script lifecycle: compile/inspect a confined .agent file, live preview, eval via a confined spec (sf agent test run-eval) or an org AiEvaluationDefinition, and fail-closed publish/activate. Edit source in the Agent Script panel or file tools. Publish and activate always confirm.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'compile',
            'inspect',
            'preview.start',
            'preview.send',
            'preview.end',
            'eval.run',
            'lifecycle.list',
            'lifecycle.publish',
            'lifecycle.activate'
          ]
        },
        apiName: { type: 'string' },
        path: { type: 'string' },
        sessionId: { type: 'string' },
        utterance: { type: 'string' },
        specPath: { type: 'string' },
        aiEvaluationDefinitionName: { type: 'string' },
        botVersionId: { type: 'string' },
        versionNumber: { type: 'number' },
        allow_untested: { type: 'boolean' },
        published: { type: 'boolean' }
      },
      required: ['action']
    },
    execute: (input, ctx) =>
      runAgent(input, ctx, connections, guardrail, artifacts, deps, readSettings, evalEvidence)
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

function fail(code: string, error: string): ToolFailure {
  return { ok: false, code, error };
}

async function runSoql(
  input: unknown,
  ctx: PluginAgentToolContext,
  connections: ConnectionManager,
  guardrail: Guardrail,
  artifacts: ArtifactStore
): Promise<ToolResult> {
  const parsed = parseSoqlInput(input);
  if (!parsed.ok) return fail('invalid_input', parsed.error);
  try {
    if (parsed.plan.action === 'schema.search') {
      const org = await connections.connect();
      const mediated = await guardrail.mediate({
        threadId: ctx.threadId,
        orgAlias: org.alias,
        orgId: org.orgId,
        orgKind: org.kind,
        summary: `Describe global sObjects on ${org.alias} (${org.kind})`
      });
      if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} schema.search.`);
      const { response } = await connections.request('/sobjects', { method: 'GET' });
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
      const org = await connections.connect();
      const mediated = await guardrail.mediate({
        threadId: ctx.threadId,
        orgAlias: org.alias,
        orgId: org.orgId,
        orgKind: org.kind,
        summary: `Describe ${parsed.plan.sobject} on ${org.alias} (${org.kind})`
      });
      if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} schema.describe.`);
      const { response } = await connections.request(`/sobjects/${parsed.plan.sobject}/describe`, { method: 'GET' });
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
    const org = await connections.connect();
    const mediated = await guardrail.mediate({
      threadId: ctx.threadId,
      orgAlias: org.alias,
      orgId: org.orgId,
      orgKind: org.kind,
      kind: parsed.plan.envelope,
      summary: `${parsed.plan.action} on ${org.alias} (${org.kind}): ${query.slice(0, 180)}`,
      fingerprint: fingerprint(query),
      preview: query.slice(0, 400)
    });
    if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} ${parsed.plan.action}.`);
    const { response } = await connections.request(parsed.plan.allRows ? '/queryAll' : '/query', {
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
  ctx: PluginAgentToolContext,
  connections: ConnectionManager,
  guardrail: Guardrail,
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
      const org = await connections.connect();
      const mediated = await guardrail.mediate({
        threadId: ctx.threadId,
        orgAlias: org.alias,
        orgId: org.orgId,
        orgKind: org.kind,
        summary: `Run Apex tests ${parsed.plan.className} on ${org.alias} (${org.kind})`
      });
      if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} test.run.`);
      const { response } = await connections.request('/tooling/runTestsSynchronous', {
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
      const org = await connections.connect();
      const mediated = await guardrail.mediate({
        threadId: ctx.threadId,
        orgAlias: org.alias,
        orgId: org.orgId,
        orgKind: org.kind,
        summary: `Fetch Apex logs on ${org.alias} (${org.kind})`
      });
      if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} logs.fetch.`);
      const { response } = await connections.request('/tooling/query', { method: 'GET', query: { q: soql } });
      if (response.status >= 400) return fail('api_error', compactError(response.status, response.json, response.text));
      const records = ((response.json as { records?: Array<{ Id?: string }> }).records ?? []).slice(0, parsed.plan.limit);
      let bodyPreview: string | undefined;
      const firstId = records[0]?.Id;
      if (firstId) {
        const body = await connections.request(`/tooling/sobjects/ApexLog/${firstId}/Body`, { method: 'GET' });
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
    const org = await connections.connect();
    const mediated = await guardrail.mediate({
      threadId: ctx.threadId,
      orgAlias: org.alias,
      orgId: org.orgId,
      orgKind: org.kind,
      kind: 'apex.anonymous',
      summary: `Anonymous Apex on ${org.alias} (${org.kind})${parsed.plan.mutationLikely ? ' — mutation-like tokens detected' : ''}${parsed.plan.allowMutation ? ' (allow_mutation intent)' : ''}`,
      fingerprint: fingerprint(`${org.orgId}:${body}`),
      preview: body.slice(0, 400)
    });
    if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} anon.run.`);
    const { response } = await connections.request('/tooling/executeAnonymous/', {
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
  connections: ConnectionManager,
  guardrail: Guardrail,
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
      return await runAgentLocal(parsed.plan, snapshot, deps);
    }
    if (parsed.plan.action === 'eval.run') {
      return await runAgentEval(parsed.plan, ctx, connections, guardrail, artifacts, deps, snapshot, evalEvidence);
    }
    if (parsed.plan.action.startsWith('preview.')) {
      return await runAgentPreview(parsed.plan, ctx, connections, guardrail, artifacts, deps, snapshot);
    }
    if (parsed.plan.action === 'lifecycle.list') {
      return await runAgentList(ctx, connections, guardrail);
    }
    if (parsed.plan.action === 'lifecycle.publish') {
      return await runAgentPublish(parsed.plan, ctx, connections, guardrail, artifacts, deps, snapshot);
    }
    return await runAgentActivate(parsed.plan, ctx, connections, guardrail, artifacts, deps, snapshot, evalEvidence);
  } catch (error) {
    return connectionFailure(error);
  }
}

async function requireDxRoot(
  snapshot: PluginSettingsValues,
  deps: SalesforceDeps
): Promise<{ ok: true; projectRoot: string } | ToolFailure> {
  if (!snapshot.projectRoot || !isDxProject(snapshot.projectRoot, deps.exists)) {
    return fail('not_configured', 'Set DX project root to a folder that contains sfdx-project.json.');
  }
  return { ok: true, projectRoot: deps.realpath(snapshot.projectRoot) };
}

async function runAgentLocal(
  plan: AgentPlan,
  snapshot: PluginSettingsValues,
  deps: SalesforceDeps
): Promise<ToolResult> {
  const loaded = await loadAgentBundles(plan, snapshot, deps);
  if (!('projectRoot' in loaded)) return loaded;
  if (plan.action === 'inspect' && !plan.apiName && !plan.path) {
    return {
      ok: true,
      summary: `${loaded.bundles.length} Agent Script bundle(s)`,
      data: loaded.bundles
    };
  }
  if (!loaded.bundle) return fail('not_found', `Agent Script bundle not found: ${plan.apiName ?? plan.path}`);
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
      'No Agent Script compiler. Install the official compiler under the DX project node_modules or the sf agent plugin, then retry compile.'
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
    return fail('not_configured', 'Set a default org alias under Plugins → Salesforce to compile with sf agent validate.');
  }
  const result = await deps.execSf(validateArgs(loaded.bundle.apiName, alias), agentCliOpts(loaded.projectRoot));
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

async function loadAgentBundles(
  plan: Pick<AgentPlan, 'apiName' | 'path'>,
  snapshot: PluginSettingsValues,
  deps: SalesforceDeps
): Promise<
  | { ok: true; projectRoot: string; bundles: ReturnType<typeof scanAgentBundles>; bundle: ReturnType<typeof findAgentBundle> }
  | ToolFailure
> {
  const root = await requireDxRoot(snapshot, deps);
  if (!('projectRoot' in root)) return root;
  if (plan.path) {
    const confined = resolveUnderRoot(root.projectRoot, plan.path, deps.realpath);
    if (!confined) return fail('path_refused', 'Agent Script path must stay inside the configured DX project root.');
  }
  const bundles = scanAgentBundles(root.projectRoot, deps);
  return {
    ok: true,
    projectRoot: root.projectRoot,
    bundles,
    bundle: findAgentBundle(bundles, plan.apiName, plan.path)
  };
}

async function mediateOrgRead(
  ctx: PluginAgentToolContext,
  connections: ConnectionManager,
  guardrail: Guardrail,
  summary: string | ((org: ResolvedOrg) => string),
  kind?: EnvelopeKind,
  extra?: { fingerprint?: string; preview?: string }
) {
  const org = await connections.connect();
  const mediated = await guardrail.mediate({
    threadId: ctx.threadId,
    orgAlias: org.alias,
    orgId: org.orgId,
    orgKind: org.kind,
    kind,
    summary: typeof summary === 'function' ? summary(org) : summary,
    fingerprint: extra?.fingerprint,
    preview: extra?.preview
  });
  return { org, mediated };
}

async function runAgentPreview(
  plan: AgentPlan,
  ctx: PluginAgentToolContext,
  connections: ConnectionManager,
  guardrail: Guardrail,
  artifacts: ArtifactStore,
  deps: SalesforceDeps,
  snapshot: PluginSettingsValues
): Promise<ToolResult> {
  const verb = plan.action === 'preview.start' ? 'start' : plan.action === 'preview.send' ? 'send' : 'end';
  const resolved = await resolvePreviewIdentity(plan, snapshot, deps, verb === 'start');
  if ('code' in resolved) return resolved;
  const label = resolved.identity?.apiName ?? plan.sessionId ?? '';
  const { org, mediated } = await mediateOrgRead(
    ctx,
    connections,
    guardrail,
    (connected) => `${plan.action} ${label} on ${connected.alias} (${connected.kind})`
  );
  if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} ${plan.action}.`);
  const result = await deps.execSf(
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
  connections: ConnectionManager,
  guardrail: Guardrail,
  artifacts: ArtifactStore,
  deps: SalesforceDeps,
  snapshot: PluginSettingsValues,
  evalEvidence: EvalEvidenceStore
): Promise<ToolResult> {
  if (plan.specPath) {
    return runAgentEvalSpec(plan, ctx, connections, guardrail, artifacts, deps, snapshot, evalEvidence);
  }
  return runAgentEvalDefinition(plan, ctx, connections, guardrail, artifacts, deps, evalEvidence);
}

async function runAgentEvalSpec(
  plan: AgentPlan,
  ctx: PluginAgentToolContext,
  connections: ConnectionManager,
  guardrail: Guardrail,
  artifacts: ArtifactStore,
  deps: SalesforceDeps,
  snapshot: PluginSettingsValues,
  evalEvidence: EvalEvidenceStore
): Promise<ToolResult> {
  const root = await requireDxRoot(snapshot, deps);
  if (!('projectRoot' in root)) return root;
  const specFile = resolveUnderRoot(root.projectRoot, plan.specPath ?? '', deps.realpath);
  if (!specFile) return fail('path_refused', 'Eval spec must stay inside the configured DX project root.');
  const specText = deps.readFile(specFile);
  if (specText === null) return fail('not_found', `Eval spec not found: ${plan.specPath}`);
  const { org, mediated } = await mediateOrgRead(
    ctx,
    connections,
    guardrail,
    (connected) => `eval.run ${plan.specPath} on ${connected.alias} (${connected.kind})`
  );
  if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} eval.run.`);
  const result = await deps.execSf(runEvalArgs(specFile, org.alias), agentCliOpts(root.projectRoot));
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
  connections: ConnectionManager,
  guardrail: Guardrail,
  artifacts: ArtifactStore,
  deps: SalesforceDeps,
  evalEvidence: EvalEvidenceStore
): Promise<ToolResult> {
  const definition = plan.aiEvaluationDefinitionName ?? '';
  const { org, mediated } = await mediateOrgRead(
    ctx,
    connections,
    guardrail,
    (connected) => `eval.run ${definition} on ${connected.alias} (${connected.kind})`
  );
  if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} eval.run.`);
  const created = await connections.request(EVAL_RUNS_PATH, {
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
  const polled = await pollEvalRun(connections, deps, runId);
  if (!polled.ok) return polled;
  const results = await connections.request(evalResultsPath(runId), {
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
  connections: ConnectionManager,
  deps: SalesforceDeps,
  runId: string
): Promise<{ ok: true; payload: unknown } | { ok: false; error: string; code: string }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let payload: unknown = null;
  for (let attempt = 0; attempt < EVAL_POLL_MAX_ATTEMPTS; attempt += 1) {
    const { response } = await connections.request(evalRunPath(runId), {
      method: 'GET',
      apiVersion: EVAL_API_VERSION
    });
    if (response.status >= 400) {
      return fail('api_error', compactError(response.status, response.json, response.text));
    }
    payload = response.json;
    if (isEvalTerminal(evalRunStatus(payload))) {
      return { ok: true, payload };
    }
    if (attempt < EVAL_POLL_MAX_ATTEMPTS - 1) await sleep(EVAL_POLL_INTERVAL_MS);
  }
  return fail('eval_timeout', `Eval run ${runId} did not complete.`);
}

async function runAgentList(
  ctx: PluginAgentToolContext,
  connections: ConnectionManager,
  guardrail: Guardrail
): Promise<ToolResult> {
  const { mediated } = await mediateOrgRead(
    ctx,
    connections,
    guardrail,
    (org) => `lifecycle.list BotVersion on ${org.alias} (${org.kind})`
  );
  if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} lifecycle.list.`);
  const { response } = await connections.request('/tooling/query', { method: 'GET', query: { q: BOT_VERSION_SOQL } });
  if (response.status >= 400) return fail('api_error', compactError(response.status, response.json, response.text));
  const records = ((response.json as { records?: unknown[] })?.records ?? []).slice(0, 25);
  return { ok: true, summary: `${records.length} BotVersion(s)`, data: { records } };
}

async function runAgentPublish(
  plan: AgentPlan,
  ctx: PluginAgentToolContext,
  connections: ConnectionManager,
  guardrail: Guardrail,
  artifacts: ArtifactStore,
  deps: SalesforceDeps,
  snapshot: PluginSettingsValues
): Promise<ToolResult> {
  const loaded = await loadAgentBundles(plan, snapshot, deps);
  if (!('projectRoot' in loaded)) return loaded;
  const apiName = loaded.bundle?.apiName ?? plan.apiName;
  if (!apiName) return fail('invalid_input', 'lifecycle.publish requires apiName or path.');
  if (!loaded.bundle) return fail('not_found', `Agent Script bundle not found: ${plan.apiName ?? plan.path}`);
  const { org, mediated } = await mediateOrgRead(
    ctx,
    connections,
    guardrail,
    (connected) => `Publish inactive Agent Script version ${apiName} on ${connected.alias} (${connected.kind})`,
    'agent.publish',
    { preview: apiName }
  );
  if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} lifecycle.publish.`);
  const result = await deps.execSf(publishArgs(apiName, org.alias), agentCliOpts(loaded.projectRoot));
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
  connections: ConnectionManager,
  guardrail: Guardrail,
  artifacts: ArtifactStore,
  deps: SalesforceDeps,
  snapshot: PluginSettingsValues,
  evalEvidence: EvalEvidenceStore
): Promise<ToolResult> {
  const apiName = plan.apiName ?? '';
  const botVersionId = plan.botVersionId || (plan.versionNumber !== undefined ? String(plan.versionNumber) : apiName);
  if (!botVersionId) return fail('invalid_input', 'lifecycle.activate requires apiName or botVersionId.');
  const org = await connections.connect();
  const gate = canActivate({
    evidence: await evalEvidence.get(org.orgId, botVersionId),
    orgId: org.orgId,
    botVersionId,
    allowUntested: plan.allowUntested
  });
  if (!gate.ok) return fail(gate.code, gate.error);
  const { mediated } = await mediateOrgRead(
    ctx,
    connections,
    guardrail,
    (connected) =>
      `Activate Agent Script ${apiName || botVersionId} (${gate.untested ? 'untested intent' : 'eval evidence'}) on ${connected.alias} (${connected.kind})`,
    'agent.activate',
    { preview: apiName || botVersionId }
  );
  if (!mediated.approved) return fail('refused', `Operator ${mediated.reason} lifecycle.activate.`);
  const result = await deps.execSf(
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
  if (!snapshot.projectRoot.trim() || !isDxProject(snapshot.projectRoot, deps.exists)) return undefined;
  return deps.realpath(snapshot.projectRoot);
}

async function resolvePreviewIdentity(
  plan: AgentPlan,
  snapshot: PluginSettingsValues,
  deps: SalesforceDeps,
  requireIdentity: boolean
): Promise<{ identity?: AgentPreviewIdentity; projectRoot?: string } | ToolFailure> {
  if (plan.published) {
    const apiName = plan.apiName;
    if (!apiName) return fail('invalid_input', 'published preview requires apiName.');
    return { identity: { flag: 'api-name', apiName }, projectRoot: dxProjectRoot(snapshot, deps) };
  }
  if (plan.path) {
    const loaded = await loadAgentBundles(plan, snapshot, deps);
    if (!('projectRoot' in loaded)) return loaded;
    if (!loaded.bundle) return fail('not_found', `Agent Script bundle not found: ${plan.path}`);
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
      ? [readAgentFile(snapshot.projectRoot, target, deps)]
      : listAgentFiles(snapshot.projectRoot, deps).map((row) => readAgentFile(snapshot.projectRoot, row.path, deps));
    if (files.length === 0) {
      return { exitCode: 0, stdout: 'No .agent bundles in the configured DX project.\n' };
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
