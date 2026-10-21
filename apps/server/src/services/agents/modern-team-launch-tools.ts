/**
 * Modern (ACP/OpenCode thread) team-launch tools — a THIN forwarder, not a
 * reimplementation.
 *
 * The pty launch surface reaches Electron-main's loopback MCP server directly
 * (its `.mcp.json` carries a session-credentialed URL, and the `launch_team` /
 * `execution.*` tool handlers run in-process there). A Modern thread has no such
 * `.mcp.json`: its agent tools arrive as ACP `dynamicTools` whose `execute()`
 * runs here in the server-runtime utility process. So to give a Modern-thread
 * agent (the skill it runs) the SAME team-launch flow the CLI Agent surface
 * gets, we register dynamic tools with the SAME NAMES as the pty MCP tools and
 * forward each call over loopback HTTP to Electron-main's MCP route
 * `/mcp/:projectId/:sessionId/:credential`. The route already performs ALL
 * authorization (route identity, the authorize→launch handshake, per-slot
 * checks). Members use a generation-fenced route with role-scoped execution
 * verbs, never the owner launch surface.
 *
 * Trust boundary: identity (`projectId`, the thread id used as `sessionId`) is
 * taken from the tool `ctx`, never from agent input — the same rule the pty
 * route enforces. The session credential is minted here from the shared signing
 * key (`controlCredentialForSession`), which only proves "a trusted local
 * process is calling"; liveness/authorization of the ACP thread as a launcher
 * is decided authoritatively by Electron-main's route gates and lifecycle
 * binding resolver. No credentialed MCP URL is exposed to the ACP client.
 *
 * Visibility is gated independently: `teamLaunchEnabled` hides `launch_team`
 * siblings; `teamJobLaunchEnabled` hides owner execution verbs. Either set is
 * also hidden until the loopback endpoint is known.
 */

import { controlCredentialForSession } from '@zana-ai/zcc-host-daemon/control-credential';
import type { PluginAgentToolContext } from '@zana-ai/zcc-plugin-sdk/server';
import { jsonSchemaAgentToolRecord } from '@zana-ai/zcc-plugin-sdk/internal/host-policy';
import { LAUNCH_TEAM_DESCRIPTION } from './launch-team-mcp-tool.js';
import {
  SQUAD_PLAN_CHECK_DESCRIPTION,
  SQUAD_PLAN_CHECK_JSON_SCHEMA,
  SQUAD_PROPOSE_DESCRIPTION,
  SQUAD_PROPOSE_JSON_SCHEMA
} from '../squad-proposals/squad-proposal-mcp-tools.js';
import type { PluginAgentToolSource } from '../../plugins/plugin-agent-tools.js';
import { EXECUTION_MEMBER_TOOL_NAMES, getExecutionToolDescriptors, type ExecutionMemberFence } from '../execution/execution-mcp-tool.js';

/** Internal, colon-free id (kept out of the wire `PluginIdSchema` surface). */
export const MODERN_TEAM_LAUNCH_PLUGIN_ID = 'host-team-launch';

/** Tool names — identical to the pty MCP tools so the skill flow is one flow. */
export const MODERN_TEAM_LAUNCH_TOOL_NAMES = [
  'authorize_team_launch',
  'launch_team',
  'get_team_launch',
  'cancel_team_launch',
  'report_team_task'
] as const;

/** Owner-session execution verbs exposed to ACP clients. */
export const MODERN_OWNER_EXECUTION_TOOL_NAMES = [
  'execution_start',
  'execution_snapshot',
  'execution_respond',
  'execution_resume_binding',
  'squad_propose',
  'squad_plan_check',
  'list_teams'
] as const;

export interface ModernTeamLaunchConfig {
  /** `http://127.0.0.1:<port>` of Electron-main's MCP server; absent until ready. */
  mcpBaseUrl?: string;
  /** Mirrors the pty `launch_team` gate; when false those tools are hidden. */
  teamLaunchEnabled: boolean;
  /**
   * Mirrors the pty owner-execution gate (`execution.start` / `snapshot` /
   * `resume_binding`). Distinct from `teamLaunchEnabled` — a Job Team start
   * does not require the bare `launch_team` flag.
   */
  teamJobLaunchEnabled?: boolean;
}

export interface CallMcpToolArgs {
  url: string;
  name: string;
  input: unknown;
  signal?: AbortSignal;
}

export interface ModernTeamLaunchSourceDeps {
  /** Read the live config each call (mcpBaseUrl arrives post-boot). */
  getConfig: () => ModernTeamLaunchConfig;
  /** Host-attested thread metadata. Members never inherit owner launch tools. */
  resolveMember?: (threadId: string, projectId: string) => ModernTeamMember | undefined | Promise<ModernTeamMember | undefined>;
  /** Mint the session control credential; defaults to the shared signer. */
  credentialFor?: (sessionId: string) => string;
  /** Perform the loopback MCP `tools/call`; injectable for tests. */
  callMcpTool?: (args: CallMcpToolArgs) => Promise<{ ok: boolean; text: string }>;
}

export interface ModernTeamMember extends ExecutionMemberFence {
  role: 'worker' | 'orchestrator';
  executionId?: string;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: unknown;
  /** Loopback MCP tool name when the catalog name is an alias. */
  mcpName?: string;
}

const SLOT_ID = { type: 'string', description: 'Host slot id from authorize_team_launch.' };
const LAUNCH_REQUEST_ID = { type: 'string', description: 'Unique id shared across authorize_team_launch and launch_team.' };

const TOOL_DEFS: readonly ToolDef[] = [
  {
    name: 'authorize_team_launch',
    description: 'Authorize exact per-slot Team launch tasks. Returns host slot ids and one-time authorization ids. Call before launch_team.',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string', description: 'Team to launch (from list_teams).' },
        projectId: { type: 'string', description: 'Optional; defaults to your own project.' },
        launchRequestId: LAUNCH_REQUEST_ID,
        deadlineMs: { type: 'number' },
        maxConcurrent: { type: 'number' },
        maxLaunches: { type: 'number' },
        slots: {
          type: 'array',
          items: { type: 'object', properties: { initialTask: { type: 'string' } }, required: ['initialTask'] }
        }
      },
      required: ['teamId', 'launchRequestId', 'slots']
    }
  },
  {
    name: 'launch_team',
    description: LAUNCH_TEAM_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string', description: 'Team to launch (from list_teams).' },
        projectId: { type: 'string', description: 'Optional; defaults to your own project.' },
        launchRequestId: LAUNCH_REQUEST_ID,
        deadlineMs: { type: 'number' },
        maxConcurrent: { type: 'number' },
        maxLaunches: { type: 'number' },
        admissionDigest: { type: 'string', description: 'Admission digest returned by authorization.' },
        slots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              slotId: SLOT_ID,
              initialTask: { type: 'string' },
              authorizationId: { type: 'string', description: 'One-time id from authorize_team_launch.' }
            },
            required: ['slotId', 'initialTask', 'authorizationId']
          }
        }
      },
      required: ['teamId', 'launchRequestId', 'slots']
    }
  },
  {
    name: 'get_team_launch',
    description: 'Read caller-scoped durable Team launch and worker lifecycle state.',
    inputSchema: { type: 'object', properties: { launchRequestId: LAUNCH_REQUEST_ID }, required: ['launchRequestId'] }
  },
  {
    name: 'cancel_team_launch',
    description: 'Cancel workers belonging to one Team launch request created by this thread.',
    inputSchema: { type: 'object', properties: { launchRequestId: LAUNCH_REQUEST_ID }, required: ['launchRequestId'] }
  },
  {
    name: 'report_team_task',
    description: 'Report caller-scoped Team slot task completion or failure.',
    inputSchema: {
      type: 'object',
      properties: {
        launchRequestId: LAUNCH_REQUEST_ID,
        slotId: SLOT_ID,
        outcome: { type: 'string', enum: ['complete', 'failed'] }
      },
      required: ['launchRequestId', 'slotId', 'outcome']
    }
  }
];

/** Owner verbs that are not execution tools; their definitions live with the Squad proposal surface. */
const OWNER_SQUAD_TOOL_DEFS: readonly ToolDef[] = [
  {
    name: 'squad_propose',
    mcpName: 'squad_propose',
    description: SQUAD_PROPOSE_DESCRIPTION,
    inputSchema: SQUAD_PROPOSE_JSON_SCHEMA
  },
  {
    name: 'squad_plan_check',
    mcpName: 'squad_plan_check',
    description: SQUAD_PLAN_CHECK_DESCRIPTION,
    inputSchema: SQUAD_PLAN_CHECK_JSON_SCHEMA
  },
  {
    name: 'list_teams',
    mcpName: 'list_teams',
    description: 'List the Squads you can propose, with defaultPlanning and canInferPlan.',
    inputSchema: { type: 'object', properties: {} }
  }
];

const OWNER_EXECUTION_TOOL_DEFS: readonly ToolDef[] = MODERN_OWNER_EXECUTION_TOOL_NAMES.map((name) => {
  const squadTool = OWNER_SQUAD_TOOL_DEFS.find((tool) => tool.name === name);
  if (squadTool) return squadTool;
  const descriptor = getExecutionToolDescriptors().find((tool) => tool.name.replaceAll('.', '_') === name)!;
  return { name, mcpName: descriptor.name, description: descriptor.description, inputSchema: descriptor.inputSchema };
});

// Single source of truth for which verbs are owner-execution tools — derived
// from the tool defs above so a new owner verb can't drift out of the gate.
const OWNER_EXECUTION_MCP_NAMES: ReadonlySet<string> = new Set(
  OWNER_EXECUTION_TOOL_DEFS.map((def) => def.mcpName ?? def.name)
);
const MAX_CONFIGURED_MEMBERS = 1024;

/**
 * Build the credentialed loopback MCP route for one thread's tool call. `?route=thread` tells
 * the MCP server the session is a Modern thread, so its `[Squad report]` is a queued turn.
 */
function modernThreadRoutePath(base: string, projectId: string, threadId: string, credential: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}/mcp/${encodeURIComponent(projectId)}/${encodeURIComponent(threadId)}/${encodeURIComponent(credential)}`;
}

export function modernTeamLaunchRoute(base: string, projectId: string, threadId: string, credential: string): string {
  return `${modernThreadRoutePath(base, projectId, threadId, credential)}?route=thread`;
}

/** The member fence is path context, so it precedes the `?route=thread` query. */
export function modernTeamMemberRoute(base: string, projectId: string, threadId: string, credential: string, member: ExecutionMemberFence): string {
  return `${modernThreadRoutePath(base, projectId, threadId, credential)}/member/${encodeURIComponent(member.bindingId)}/${member.generation}?route=thread`;
}

function extractText(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => (item && typeof item === 'object' && 'text' in item ? String((item as { text: unknown }).text ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}

async function defaultCallMcpTool({ url, name, input, signal }: CallMcpToolArgs): Promise<{ ok: boolean; text: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: (input ?? {}) as Record<string, unknown> }
    }),
    signal
  });
  if (!response.ok) throw new Error(`loopback MCP call failed: ${response.status}`);
  const body = await response.text();
  const payload = body.trim().startsWith('{')
    ? JSON.parse(body)
    : JSON.parse(body.split('\n').filter((line) => line.startsWith('data:')).at(-1)?.slice(5).trim() ?? '{}');
  if (payload.error) throw new Error(payload.error.message ?? 'loopback MCP request failed');
  const result = payload.result;
  return { ok: !result?.isError, text: extractText(result) };
}

function forwarder(def: ToolDef, deps: ModernTeamLaunchSourceDeps, configuredMembers: Map<string, ModernTeamMember>) {
  const credentialFor = deps.credentialFor ?? controlCredentialForSession;
  const callMcpTool = deps.callMcpTool ?? defaultCallMcpTool;
  return jsonSchemaAgentToolRecord({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    async execute(input: unknown, ctx: PluginAgentToolContext) {
      const { mcpBaseUrl, teamLaunchEnabled, teamJobLaunchEnabled } = deps.getConfig();
      const mcpName = def.mcpName ?? def.name;
      const ownerVerb = OWNER_EXECUTION_MCP_NAMES.has(mcpName);
      const memberVerb = mcpName.startsWith('execution.') && !ownerVerb;
      const member = await deps.resolveMember?.(ctx.threadId, ctx.projectId);
      const configuredMember = configuredMembers.get(JSON.stringify([ctx.projectId, ctx.threadId]));
      if (member || configuredMember || memberVerb) {
        if (!member || !configuredMember || member.bindingId !== configuredMember.bindingId
          || member.generation !== configuredMember.generation || member.role !== configuredMember.role
          || member.executionId !== configuredMember.executionId
          || !EXECUTION_MEMBER_TOOL_NAMES[member.role]?.some((name) => name === mcpName)) {
          return { ok: false, message: `${def.name} unavailable: thread is not configured for this member role and generation.` };
        }
        if (input && typeof input === 'object' && 'executionId' in input && member.executionId
          && input.executionId !== member.executionId) {
          return { ok: false, message: `${def.name} unavailable: thread is not bound to this execution.` };
        }
        if (mcpName === 'execution.event' && input && typeof input === 'object'
          && ('slotId' in input || 'producerRole' in input)) {
          return { ok: false, message: `${def.name} failed: member identity is host-bound.` };
        }
      }
      const enabled = member ? true : ownerVerb ? teamJobLaunchEnabled === true : teamLaunchEnabled;
      if (!enabled) {
        return {
          ok: false,
          message: ownerVerb
            ? `${def.name} unavailable: team job launch is disabled.`
            : `${def.name} unavailable: team launch is disabled.`
        };
      }
      if (!mcpBaseUrl) return { ok: false, message: `${def.name} unavailable: team launch endpoint is not ready yet.` };
      const credential = credentialFor(ctx.threadId);
      const url = member
        ? modernTeamMemberRoute(mcpBaseUrl, ctx.projectId, ctx.threadId, credential, configuredMember!)
        : modernTeamLaunchRoute(mcpBaseUrl, ctx.projectId, ctx.threadId, credential);
      try {
        if (mcpName.startsWith('execution.')) {
          const parsed = getExecutionToolDescriptors().find((descriptor) => descriptor.name === mcpName)!.schema.safeParse(input);
          if (!parsed.success) return { ok: false, message: `${def.name} failed: invalid arguments.` };
          input = parsed.data;
        }
        const { ok, text } = await callMcpTool({ url, name: mcpName, input, signal: ctx.signal });
        return ok ? text || '{}' : { ok: false, message: text || `${def.name} failed.` };
      } catch (error) {
        return { ok: false, message: `${def.name} failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
  });
}

/**
 * Build the host agent-tool source that surfaces the team-launch forwarders to
 * Modern threads. Prepended into `PluginService.agentToolSources()` so it rides
 * the same `sessionTools`/`invokeAgentTool` path as plugin-contributed tools.
 */
export function createModernTeamLaunchSource(deps: ModernTeamLaunchSourceDeps): PluginAgentToolSource {
  // First configured generation stays pinned even if the same thread is reconfigured.
  const configuredMembers = new Map<string, ModernTeamMember>();
  const memberNames = new Set<string>(Object.values(EXECUTION_MEMBER_TOOL_NAMES).flat());
  const memberDefs = getExecutionToolDescriptors().filter((descriptor) => memberNames.has(descriptor.name)
    && !OWNER_EXECUTION_MCP_NAMES.has(descriptor.name)).map((descriptor) => {
    const inputSchema = descriptor.name === 'execution.event'
      ? { ...descriptor.inputSchema, properties: Object.fromEntries(Object.entries(descriptor.inputSchema.properties as Record<string, unknown>)
        .filter(([key]) => key !== 'slotId' && key !== 'producerRole')) }
      : descriptor.inputSchema;
    return { name: descriptor.name.replaceAll('.', '_'), mcpName: descriptor.name, description: descriptor.description, inputSchema };
  });
  return {
    pluginId: MODERN_TEAM_LAUNCH_PLUGIN_ID,
    tools: [...TOOL_DEFS, ...OWNER_EXECUTION_TOOL_DEFS, ...memberDefs].map((def) => forwarder(def, deps, configuredMembers)),
    configurers: [
      async (ctx) => {
        const { mcpBaseUrl, teamLaunchEnabled, teamJobLaunchEnabled } = deps.getConfig();
        if (!mcpBaseUrl) return { tools: [] };
        const key = JSON.stringify([ctx.projectId, ctx.threadId]);
        const member = await deps.resolveMember?.(ctx.threadId ?? '', ctx.projectId ?? '');
        if (member) {
          if (!member.bindingId || !Number.isSafeInteger(member.generation) || member.generation < 1
            || !EXECUTION_MEMBER_TOOL_NAMES[member.role]) return { tools: [] };
          if (!configuredMembers.has(key)) {
            // Never evict a fence: old configured clients must stay stale.
            if (configuredMembers.size >= MAX_CONFIGURED_MEMBERS) return { tools: [] };
            configuredMembers.set(key, { ...member });
          }
          const configured = configuredMembers.get(key)!;
          if (configured.bindingId !== member.bindingId || configured.generation !== member.generation
            || configured.role !== member.role || configured.executionId !== member.executionId) return { tools: [] };
          return { tools: EXECUTION_MEMBER_TOOL_NAMES[member.role].map((name) => name.replaceAll('.', '_')) };
        }
        if (configuredMembers.has(key)) return { tools: [] };
        const tools: string[] = [];
        if (teamLaunchEnabled) tools.push(...MODERN_TEAM_LAUNCH_TOOL_NAMES);
        if (teamJobLaunchEnabled) tools.push(...MODERN_OWNER_EXECUTION_TOOL_NAMES);
        return { tools };
      }
    ]
  };
}
