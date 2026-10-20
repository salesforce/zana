import type { AgentPlan } from './agent.js';
import { compactError } from './dx-project.js';
import { orgReadEnvelope } from './guardrail.js';
import { isConfirmingOrg } from './org-resolution.js';
import {
  RELEASE_ACTIONS,
  RELEASE_READ_GRANT_MS,
  type ReleaseAction,
  type ReleaseApprovalBinding,
  type ReleaseApprovalRequest,
  type ReleaseEvalEvidence,
  type ReleasePrepared,
  type ReleaseState,
  type ReleaseVersion,
  type ReleaseVersionSource
} from './release-contract.js';
import type { SalesforceSdk } from './sdk-contract.js';
import { rpcString } from './studio-server-context.js';
import type { EnvelopeKind, EvalEvidence, PublicOrgView, SalesforceResponse, ToolFailure, ToolResult } from './types.js';

const API_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const READ_GRANT_CAP = 64;

type ReleaseOrg = Pick<PublicOrgView, 'alias' | 'orgId' | 'kind'>;

function fail(code: string, error: string): ToolFailure {
  return { ok: false, code, error };
}

/** One agent's versions, newest first. The name is checked, never quoted from input. */
export function versionsSoql(apiName: string): string {
  if (!API_NAME.test(apiName)) throw new Error(`Invalid Agentforce API name: ${apiName}`);
  return `SELECT Id, Status, VersionNumber, LastModifiedDate FROM BotVersion WHERE BotDefinition.DeveloperName = '${apiName}' ORDER BY VersionNumber DESC LIMIT 25`;
}

export function parseVersions(records: unknown): Array<Omit<ReleaseVersion, 'evidence'>> {
  if (!Array.isArray(records)) return [];
  const versions: Array<Omit<ReleaseVersion, 'evidence'>> = [];
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const row = record as Record<string, unknown>;
    const versionNumber = typeof row.VersionNumber === 'number' ? row.VersionNumber : Number(row.VersionNumber);
    if (typeof row.Id !== 'string' || !row.Id || !Number.isInteger(versionNumber)) continue;
    versions.push({
      id: row.Id,
      versionNumber,
      active: row.Status === 'Active',
      modifiedAt: typeof row.LastModifiedDate === 'string' ? row.LastModifiedDate : null
    });
  }
  return versions.sort((a, b) => b.versionNumber - a.versionNumber);
}

export interface ReleaseSubject {
  action: ReleaseAction;
  org: ReleaseOrg;
  apiName: string;
  /** Publish: the source SHA-256. Activate: the BotVersion id. Deactivate: the active BotVersion id. */
  revision?: string;
  versionNumber?: number;
}

/**
 * What the sheet signs. The server rebuilds it from the file on disk, the
 * connected org and the org's version list, so a token only fits the exact
 * source, org and version the person saw. Production and unknown orgs also
 * make the person type the alias, except for a read.
 */
export function releaseBinding(subject: ReleaseSubject): ReleaseApprovalBinding {
  const { action, org, apiName } = subject;
  const label = action === 'org.read'
    ? `${apiName} versions`
    : action === 'agent.activate' && subject.versionNumber !== undefined ? `${apiName} v${subject.versionNumber}` : apiName;
  return {
    action,
    target: org.orgId,
    targetLabel: `${org.alias} (${org.kind})`,
    subject: label,
    ...(subject.revision ? { revision: subject.revision } : {}),
    ...(isConfirmingOrg(org.kind) && action !== 'org.read' ? { confirmText: org.alias } : {})
  };
}

function evidenceLine(evidence: ReleaseEvalEvidence | null): string {
  if (!evidence) return 'No eval evidence for this version. Activating it is untested.';
  const day = new Date(evidence.at).toISOString().slice(0, 10);
  return evidence.passed ? `Eval passed for this version on ${day}.` : `The last eval for this version failed on ${day}. Activating it is untested.`;
}

/** The words around the binding. Only the binding is signed. */
export function releaseRequest(
  binding: ReleaseApprovalBinding,
  context: { org: ReleaseOrg; apiName: string; versionNumber?: number; evidence?: ReleaseEvalEvidence | null }
): ReleaseApprovalRequest {
  const { org, apiName } = context;
  const where = `${org.alias} (${org.kind})`;
  const risky = isConfirmingOrg(org.kind);
  switch (binding.action as ReleaseAction) {
    case 'agent.publish':
      return {
        binding,
        title: `Publish ${apiName}`,
        summary: `Uploads this source to ${where} as a new inactive version. Users keep the active version until you activate one.`,
        details: ['sf agent publish compiles the source first and stops on any error.'],
        confirmLabel: 'Publish',
        tone: risky ? 'danger' : 'default'
      };
    case 'agent.activate':
      return {
        binding,
        title: `Activate ${apiName} v${context.versionNumber}`,
        summary: `Makes v${context.versionNumber} the live version on ${where}. Users talk to it right away and the version active now stops serving.`,
        details: [evidenceLine(context.evidence ?? null)],
        confirmLabel: 'Activate',
        tone: risky ? 'danger' : 'default'
      };
    case 'agent.deactivate':
      return {
        binding,
        title: `Deactivate ${apiName}`,
        summary: `Takes the active version offline on ${where}. Its users lose the agent until a version is activated again.`,
        confirmLabel: 'Deactivate',
        tone: 'danger'
      };
    default:
      return {
        binding,
        title: `Read ${apiName} versions`,
        summary: `Lets the Studio read this agent's versions, compile and run evals against ${where} for ${RELEASE_READ_GRANT_MS / 60_000} minutes. Nothing changes in the org.`,
        confirmLabel: 'Allow'
      };
  }
}

/**
 * The sdk a token-approved run uses. The one envelope the person approved on
 * the sheet (same kind, same org) passes once; every other envelope goes to
 * the normal guardrail, which refuses it when there is no thread.
 */
export function withApprovedEnvelope(sdk: SalesforceSdk, approved: { kind: EnvelopeKind; orgId: string }): SalesforceSdk {
  let used = false;
  return {
    ...sdk,
    confirm(envelope, threadId) {
      if (!used && envelope.kind === approved.kind && envelope.orgId === approved.orgId) {
        used = true;
        return Promise.resolve({ approved: true, reason: 'submitted' });
      }
      return sdk.confirm(envelope, threadId);
    }
  };
}

/** Production and unknown org reads a person allowed from the Studio, per project and org, for a while. */
export class ReadGrants {
  private readonly grants = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  grant(scope: string, orgId: string): number {
    const at = this.now();
    for (const [key, until] of this.grants) if (until <= at) this.grants.delete(key);
    const key = `${scope}\n${orgId}`;
    this.grants.delete(key);
    while (this.grants.size >= READ_GRANT_CAP) this.grants.delete(this.grants.keys().next().value!);
    const until = at + RELEASE_READ_GRANT_MS;
    this.grants.set(key, until);
    return until;
  }

  until(scope: string, orgId: string): number | null {
    const until = this.grants.get(`${scope}\n${orgId}`);
    return until !== undefined && until > this.now() ? until : null;
  }

  /** An sdk that passes production and unknown org reads for a granted org; everything else is unchanged. */
  wrap(sdk: SalesforceSdk, scope: string): SalesforceSdk {
    return {
      ...sdk,
      confirm: (envelope, threadId) => {
        const read = orgReadEnvelope(envelope.orgKind);
        const kind = envelope.kind ?? read;
        if (read && kind === read && envelope.orgId && this.until(scope, envelope.orgId) !== null) {
          return Promise.resolve({ approved: true, reason: 'submitted' });
        }
        return sdk.confirm(envelope, threadId);
      }
    };
  }
}

/** An sdk for a Studio button the user clicked: that click approves an org read. Explicit kinds (publish, Live) still confirm. */
export function clickedSdk(sdk: SalesforceSdk, args: unknown): SalesforceSdk {
  if (!args || typeof args !== 'object' || (args as { startedByUser?: unknown }).startedByUser !== true) return sdk;
  return {
    ...sdk,
    confirm: (envelope, threadId) => {
      const read = orgReadEnvelope(envelope.orgKind);
      if (read && (envelope.kind ?? read) === read) return Promise.resolve({ approved: true, reason: 'submitted' });
      return sdk.confirm(envelope, threadId);
    }
  };
}

export interface ReleaseSource {
  apiName: string;
  /** Project-relative path, as the Studio names it. */
  path: string;
  revision: string;
  versioned: boolean;
}

export interface ReleaseServiceOptions {
  sdk: SalesforceSdk;
  evidence: { get(orgId: string, botVersionId: string): Promise<EvalEvidence | null> };
  kv: { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> };
  grants: ReadGrants;
  now(): number;
  /** The current project, so a read grant stays with the project that asked. */
  scope(): string;
  /** Loads the agent source at a project-relative path from disk, confined to the DX project. */
  source(path: string): Promise<ReleaseSource | ToolFailure>;
  consume(token: string, binding: ReleaseApprovalBinding): Promise<boolean>;
  /** Reads one org version's Agent Script without touching the project. Throws a message the person can act on. */
  versionSource(org: PublicOrgView, apiName: string, versionNumber: number): Promise<{ fullName: string; content: string }>;
  run: Record<'publish' | 'activate' | 'deactivate', (plan: AgentPlan, sdk: SalesforceSdk) => Promise<ToolResult>>;
}

interface Planned {
  binding: ReleaseApprovalBinding;
  request: ReleaseApprovalRequest;
  org: PublicOrgView;
  source: ReleaseSource;
  version?: ReleaseVersion;
}

export function publishRecordKey(orgId: string, apiName: string): string {
  return `publish-record:${orgId}:${apiName}`;
}

/** Studio release RPCs: read the lane, prepare one sheet, and run what the sheet approved. */
export function createReleaseService(options: ReleaseServiceOptions) {
  const readSdk = () => options.grants.wrap(options.sdk, options.scope());

  async function evidenceFor(orgId: string, version: Pick<ReleaseVersion, 'id' | 'versionNumber'>): Promise<{ key: string; evidence: ReleaseEvalEvidence } | null> {
    for (const key of [version.id, String(version.versionNumber)]) {
      const row = await options.evidence.get(orgId, key);
      if (row) return { key, evidence: { passed: row.passed === true, at: row.at } };
    }
    return null;
  }

  /** Reads the agent's versions through the guardrail: sandboxes pass, others need a read grant. */
  async function listVersions(org: PublicOrgView, apiName: string): Promise<ReleaseVersion[] | ToolFailure> {
    const sdk = readSdk();
    const decision = await sdk.confirm({
      orgAlias: org.alias,
      orgId: org.orgId,
      orgKind: org.kind,
      summary: `Read ${apiName} versions on ${org.alias} (${org.kind})`
    }, '');
    if (!decision.approved) return fail('read_required', `${org.alias} is a ${org.kind} org. Load its versions first.`);
    // BotVersion is a data API object; the Tooling API rejects it with INVALID_TYPE.
    let response: SalesforceResponse;
    try {
      ({ response } = await sdk.request('/query', { method: 'GET', query: { q: versionsSoql(apiName) } }));
    } catch {
      return fail('api_error', `Could not read ${apiName} versions. Check the org connection and refresh.`);
    }
    if (response.status >= 400) return fail('api_error', `Could not read ${apiName} versions: ${compactError(response.status, response.json, response.text).slice(0, 320)}`);
    const rows = parseVersions((response.json as { records?: unknown } | null)?.records);
    const versions: ReleaseVersion[] = [];
    for (const row of rows) versions.push({ ...row, evidence: (await evidenceFor(org.orgId, row))?.evidence ?? null });
    return versions;
  }

  async function loadSource(args: unknown): Promise<ReleaseSource | ToolFailure> {
    const path = rpcString(args, 'path');
    if (!path) return fail('invalid_input', 'Pick an agent source first.');
    const source = await options.source(path);
    if ('ok' in source) return source;
    if (!API_NAME.test(source.apiName)) return fail('invalid_input', `Invalid Agentforce API name: ${source.apiName}`);
    return source;
  }

  async function state(args: unknown): Promise<{ ok: true; data: ReleaseState } | ToolFailure> {
    const source = await loadSource(args);
    if ('ok' in source) return source;
    const org = await options.sdk.connect();
    const lastPublish = await options.kv.get<{ revision: string; at: number }>(publishRecordKey(org.orgId, source.apiName));
    const confirming = isConfirmingOrg(org.kind);
    const readUntil = confirming ? options.grants.until(options.scope(), org.orgId) : null;
    const base = {
      org: { alias: org.alias, orgId: org.orgId, kind: org.kind },
      agent: {
        apiName: source.apiName,
        path: source.path,
        revision: source.revision,
        versioned: source.versioned,
        lastPublish: lastPublish && typeof lastPublish.revision === 'string' ? { revision: lastPublish.revision, at: lastPublish.at } : null
      },
      readUntil
    };
    if (confirming && readUntil === null) return { ok: true, data: { ...base, needsReadApproval: true, versions: [] } };
    const versions = await listVersions(org, source.apiName);
    if (!Array.isArray(versions)) {
      // Publishing does not depend on a version list. Keep the source and target
      // available, while activation still fails closed through listVersions().
      if (versions.code === 'read_required') return { ok: true, data: { ...base, readUntil: null, needsReadApproval: true, versions: [] } };
      return { ok: true, data: { ...base, needsReadApproval: false, versions: [], versionsError: versions.error } };
    }
    return { ok: true, data: { ...base, needsReadApproval: false, versions } };
  }

  /** Rebuilds the binding from disk and the org, the same way for prepare and for run. */
  async function plan(args: unknown): Promise<Planned | ToolFailure> {
    const action = rpcString(args, 'action') as ReleaseAction;
    if (!RELEASE_ACTIONS.includes(action)) return fail('invalid_input', `Unknown release action. Use ${RELEASE_ACTIONS.join(', ')}.`);
    const source = await loadSource(args);
    if ('ok' in source) return source;
    const org = await options.sdk.connect();
    const confirming = isConfirmingOrg(org.kind);
    const context = { org, apiName: source.apiName };
    if (action === 'org.read') {
      if (!confirming) return fail('not_needed', `${org.alias} is a ${org.kind} org; reading it needs no approval.`);
      const binding = releaseBinding({ action, org, apiName: source.apiName });
      return { binding, request: releaseRequest(binding, context), org, source };
    }
    if (action === 'agent.publish') {
      if (source.versioned) return fail('versioned_source', 'Create a new local draft from this source before publishing a retrieved version.');
      const binding = releaseBinding({ action, org, apiName: source.apiName, revision: source.revision });
      return { binding, request: releaseRequest(binding, context), org, source };
    }
    const versions = await listVersions(org, source.apiName);
    if (!Array.isArray(versions)) return versions;
    if (action === 'agent.deactivate') {
      const active = versions.find(row => row.active);
      if (!active) return fail('no_active_version', `${source.apiName} has no active version on ${org.alias}.`);
      const binding = releaseBinding({ action, org, apiName: source.apiName, revision: active.id });
      return { binding, request: releaseRequest(binding, context), org, source, version: active };
    }
    const raw = args && typeof args === 'object' ? (args as { versionNumber?: unknown }).versionNumber : undefined;
    const version = typeof raw === 'number' ? versions.find(row => row.versionNumber === raw) : undefined;
    if (!version) return fail('not_found', `Pick a version of ${source.apiName} that exists on ${org.alias}.`);
    if (version.active) return fail('already_active', `${source.apiName} v${version.versionNumber} is already active.`);
    if (confirming && !version.evidence?.passed) {
      return fail('eval_required', `${org.alias} is a ${org.kind} org. Run a passing eval for v${version.versionNumber} before activating it.`);
    }
    const binding = releaseBinding({ action, org, apiName: source.apiName, revision: version.id, versionNumber: version.versionNumber });
    return {
      binding,
      request: releaseRequest(binding, { ...context, versionNumber: version.versionNumber, evidence: version.evidence }),
      org,
      source,
      version
    };
  }

  async function prepare(args: unknown): Promise<{ ok: true; data: ReleasePrepared } | ToolFailure> {
    const planned = await plan(args);
    if ('ok' in planned) return planned;
    return { ok: true, data: { request: planned.request } };
  }

  async function run(args: unknown): Promise<ToolResult> {
    const planned = await plan(args);
    if ('ok' in planned) return planned;
    const token = rpcString(args, 'token');
    if (!token || !(await options.consume(token, planned.binding))) {
      return fail('approval_invalid', 'This approval expired, was already used, or the file, org or version changed since. Approve again.');
    }
    const { org, source, version } = planned;
    const action = planned.binding.action as ReleaseAction;
    if (action === 'org.read') {
      const until = options.grants.grant(options.scope(), org.orgId);
      return { ok: true, summary: `Reading ${org.alias} allowed until ${new Date(until).toISOString()}`, data: { readUntil: until } };
    }
    const sdk = withApprovedEnvelope(readSdk(), { kind: action, orgId: org.orgId });
    const base = { apiName: source.apiName, allowUntested: false, published: false, live: false };
    if (action === 'agent.publish') {
      const result = await options.run.publish({ ...base, action: 'lifecycle.publish', path: source.path }, sdk);
      if (result.ok) await options.kv.set(publishRecordKey(org.orgId, source.apiName), { revision: source.revision, at: options.now() });
      return result;
    }
    if (action === 'agent.deactivate') return options.run.deactivate({ ...base, action: 'lifecycle.deactivate' }, sdk);
    const matched = await evidenceFor(org.orgId, version!);
    return options.run.activate({
      ...base,
      action: 'lifecycle.activate',
      versionNumber: version!.versionNumber,
      botVersionId: matched?.key ?? version!.id,
      // The sheet already said this version is untested; a production org refused it in plan().
      allowUntested: !isConfirmingOrg(org.kind)
    }, sdk);
  }

  /** One version's source, read-only. It reads the org, so it passes the same guardrail as the version list. */
  async function versionSource(args: unknown): Promise<{ ok: true; data: ReleaseVersionSource } | ToolFailure> {
    const source = await loadSource(args);
    if ('ok' in source) return source;
    const raw = args && typeof args === 'object' ? (args as { versionNumber?: unknown }).versionNumber : undefined;
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) return fail('invalid_input', 'Pick a version to open.');
    const org = await options.sdk.connect();
    const versions = await listVersions(org, source.apiName);
    if (!Array.isArray(versions)) return versions;
    const version = versions.find(row => row.versionNumber === raw);
    if (!version) return fail('not_found', `${source.apiName} v${raw} does not exist on ${org.alias}.`);
    try {
      const read = await options.versionSource(org, source.apiName, raw);
      return { ok: true, data: { apiName: source.apiName, versionNumber: raw, active: version.active, fullName: read.fullName, content: read.content } };
    } catch (error) {
      return fail('version_unavailable', error instanceof Error ? error.message : `Could not read ${source.apiName} v${raw}.`);
    }
  }

  return { state, prepare, run, versionSource };
}
