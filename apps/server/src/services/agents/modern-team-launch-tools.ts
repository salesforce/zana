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
 * checks); this module adds no new trust logic of its own.
 *
 * Trust boundary: identity (`projectId`, the thread id used as `sessionId`) is
 * taken from the tool `ctx`, never from agent input — the same rule the pty
 * route enforces. The session credential is minted here from the shared signing
 * key (`controlCredentialForSession`), which only proves "a trusted local
 * process is calling"; liveness/authorization of the ACP thread as a launcher
 * is decided authoritatively by Electron-main's `validateTeamRouteIdentity`
 * (extended separately). Until that extension lands, the route rejects the ACP
 * thread and these tools return a clean error — this module is inert on its own.
 *
 * Visibility is gated independently: `teamLaunchEnabled` hides `launch_team`
 * siblings; `teamJobLaunchEnabled` hides owner execution verbs. Either set is
 * also hidden until the loopback endpoint is known.
 */

import { controlCredentialForSession } from '@zana-ai/zcc-host-daemon/control-credential';
import type { PluginAgentToolContext, PluginAgentToolRegistration } from '@zana-ai/zcc-plugin-sdk/server';
import { LAUNCH_TEAM_DESCRIPTION } from './launch-team-mcp-tool.js';
import type { PluginAgentToolSource } from '../../plugins/plugin-agent-tools.js';

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
  'execution_resume_binding'
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
  /** Mint the session control credential; defaults to the shared signer. */
  credentialFor?: (sessionId: string) => string;
  /** Perform the loopback MCP `tools/call`; injectable for tests. */
  callMcpTool?: (args: CallMcpToolArgs) => Promise<{ ok: boolean; text: string }>;
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

const OWNER_START_SCHEMA = {
  type: 'object',
  properties: {
    requestPath: { type: 'string', description: 'Absolute path of a one-shot execution.start request file.' },
    version: { type: 'number' },
    teamId: { type: 'string' },
    launchRequestId: { type: 'string' },
    jobTitle: { type: 'string' },
    summary: { type: 'string' },
    deadlineMs: { type: 'number' },
    maxConcurrent: { type: 'number' },
    maxLaunches: { type: 'number' },
    workflow: { type: 'object' },
    workUnits: { type: 'array', items: { type: 'object' } },
    slots: { type: 'array', items: { type: 'object' } }
  },
  required: ['version', 'teamId', 'launchRequestId', 'slots']
};

const OWNER_SNAPSHOT_SCHEMA = {
  type: 'object',
  properties: {
    executionId: { type: 'string' },
    after: { type: 'number' }
  },
  required: ['executionId']
};

const OWNER_RESUME_SCHEMA = {
  type: 'object',
  properties: {
    executionId: { type: 'string' },
    token: { type: 'string' }
  },
  required: ['executionId', 'token']
};

const OWNER_EXECUTION_TOOL_DEFS: readonly ToolDef[] = [
  {
    name: 'execution_start',
    mcpName: 'execution.start',
    description: 'Start one execution in this live session project. Pass either full request fields or a bounded requestPath. Main authorizes launch slots and stores launch identity before launch.',
    inputSchema: OWNER_START_SCHEMA
  },
  {
    name: 'execution_snapshot',
    mcpName: 'execution.snapshot',
    description: 'Read one bounded durable execution snapshot. Does not reconcile or poll Team workers.',
    inputSchema: OWNER_SNAPSHOT_SCHEMA
  },
  {
    name: 'execution_resume_binding',
    mcpName: 'execution.resume_binding',
    description: 'Bind this fresh session to an execution using a durable resume grant. Retry same token after a transient binding failure.',
    inputSchema: OWNER_RESUME_SCHEMA
  }
];

// Single source of truth for which verbs are owner-execution tools — derived
// from the tool defs above so a new owner verb can't drift out of the gate.
const OWNER_EXECUTION_MCP_NAMES: ReadonlySet<string> = new Set(
  OWNER_EXECUTION_TOOL_DEFS.map((def) => def.mcpName ?? def.name)
);

/** Build the credentialed loopback MCP route for one thread's tool call. */
export function modernTeamLaunchRoute(base: string, projectId: string, threadId: string, credential: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}/mcp/${encodeURIComponent(projectId)}/${encodeURIComponent(threadId)}/${encodeURIComponent(credential)}`;
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

function forwarder(def: ToolDef, deps: ModernTeamLaunchSourceDeps): PluginAgentToolRegistration {
  const credentialFor = deps.credentialFor ?? controlCredentialForSession;
  const callMcpTool = deps.callMcpTool ?? defaultCallMcpTool;
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    async execute(input: unknown, ctx: PluginAgentToolContext) {
      const { mcpBaseUrl, teamLaunchEnabled, teamJobLaunchEnabled } = deps.getConfig();
      const mcpName = def.mcpName ?? def.name;
      const ownerVerb = OWNER_EXECUTION_MCP_NAMES.has(mcpName);
      const enabled = ownerVerb ? teamJobLaunchEnabled === true : teamLaunchEnabled;
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
      const url = modernTeamLaunchRoute(mcpBaseUrl, ctx.projectId, ctx.threadId, credential);
      try {
        const { ok, text } = await callMcpTool({ url, name: mcpName, input, signal: ctx.signal });
        return ok ? text || '{}' : { ok: false, message: text || `${def.name} failed.` };
      } catch (error) {
        return { ok: false, message: `${def.name} failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
  };
}

/**
 * Build the host agent-tool source that surfaces the team-launch forwarders to
 * Modern threads. Prepended into `PluginService.agentToolSources()` so it rides
 * the same `sessionTools`/`invokeAgentTool` path as plugin-contributed tools.
 */
export function createModernTeamLaunchSource(deps: ModernTeamLaunchSourceDeps): PluginAgentToolSource {
  return {
    pluginId: MODERN_TEAM_LAUNCH_PLUGIN_ID,
    tools: [...TOOL_DEFS, ...OWNER_EXECUTION_TOOL_DEFS].map((def) => forwarder(def, deps)),
    configurers: [
      () => {
        const { mcpBaseUrl, teamLaunchEnabled, teamJobLaunchEnabled } = deps.getConfig();
        if (!mcpBaseUrl) return { tools: [] };
        const tools: string[] = [];
        if (teamLaunchEnabled) tools.push(...MODERN_TEAM_LAUNCH_TOOL_NAMES);
        if (teamJobLaunchEnabled) tools.push(...MODERN_OWNER_EXECUTION_TOOL_NAMES);
        return { tools };
      }
    ]
  };
}
