import { CliDiscoveryRequestSchema } from './cli-discovery.js';
import { CliCallbackControlSchema } from './cli-callbacks.js';
import { ProjectFeedRequestSchema } from './project-feed.js';
import { LibraryAgentRequestSchema } from './library-agent.js';
import { LibraryDocumentRequestSchema } from './library-documents.js';
import { SHARED_PRODUCT_EVENTS } from './shared-product.js';
import { z } from 'zod';
import { pendingInteractionUserQuestionQuestionSchema, USER_QUESTION_MAX_QUESTIONS } from '@zana-ai/zcc-domain/thread-runtime';
import { ProjectIdSchema, SessionIdSchema, PROJECT_ICONS } from '@zana-ai/zcc-domain';
import { pluginPackIdentitySchema, pluginPackInstallRequestSchema } from '@zana-ai/zcc-domain';
import { TerminalRequestCommandSchema, TerminalHostEventSchema } from './terminal-execution.js';
import { NamedCheckScopeSchema, NamedChecksSchema, ProjectSettingsPatchSchema } from './project-settings.js';
import { ProjectMetadataRequestSchema, ProjectCatalogRequestSchema } from './project-metadata-records.js';
import { ProjectHistoryRequestSchema } from './project-history.js';

/**
 * Bump when any desktop-to-server utility-process message changes shape or
 * meaning. Both endpoints reject a mismatched version before dispatching it.
 */
/** Product-event snapshot limits; measured as JSON.stringify(args).length by both the schema and the main forwarder. */
export const PRODUCT_EVENT_ARGS_MAX_CHARS = 128 * 1024;
export const PRODUCT_EVENT_ARGS_MAX_COUNT = 8;
/** Latest-wins snapshot channels: the full list/config rides in args, so a newer event supersedes an older one
 * and an oversized one can be replaced by an empty-args invalidation that readers answer with a re-read.
 * Id-carrying (projectSettings, feed) and stream (terminals:*) channels are deliberately absent. */
export const PRODUCT_EVENT_SNAPSHOT_CHANNELS: ReadonlySet<string> = new Set([
  'config:onChanged', 'scheduler:onChanged', 'scheduler:groups:onChanged', 'scheduler:onTemplatesChanged', 'goals:onChanged',
  'followups:onChanged', 'personas:onChanged', 'teams:onChanged', 'quickPrompts:onChanged', 'extensions:onChanged'
]);
export const SERVER_RUNTIME_PROTOCOL_VERSION = 18;
const ServerRuntimeProtocolVersionSchema = z.literal(SERVER_RUNTIME_PROTOCOL_VERSION);
const RequestIdSchema = z.string().uuid();
const DeadlineSchema = z.string().datetime();
const ProjectPathSchema = z.string().min(1).max(32_768);
const ProjectNameSchema = z.string().min(1).max(256).refine(
  (value) => !/[\x00-\x1f\x7f]/.test(value),
  'project name must not contain control characters'
);
const ProjectColorSchema = z.enum([
  '#2f81f7', '#3fb950', '#d4a017', '#bc8cff', '#39c5cf', '#f85149', '#ff7b72', '#8b949e'
]);
const PluginIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(128);

const MenubarAgentBaseSchema = z.object({
  agentId: z.string().min(1).max(256),
  projectId: ProjectIdSchema,
  rowKey: z.string().min(1).max(512),
  projectName: ProjectNameSchema,
  projectColor: z.string().max(32).optional(),
  title: z.string().max(4096),
  state: z.enum(['working', 'blocked', 'done', 'idle', 'unknown', 'waiting']),
  favorite: z.boolean(),
  canFavorite: z.boolean(),
  canReply: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  question: z.string().max(4096).optional(),
  resolution: z.enum(['awaiting-reply', 'done', 'paused', 'unknown']).optional()
});
export const MenubarAgentSchema = z.discriminatedUnion('kind', [
  MenubarAgentBaseSchema.extend({
    kind: z.literal('cli'),
    sessionId: z.string().min(1).max(256),
    repliable: z.boolean()
  }).strict(),
  MenubarAgentBaseSchema.extend({
    kind: z.literal('thread'),
    threadId: z.string().min(1).max(256),
    status: z.string().max(128),
    hasPendingInteraction: z.boolean(),
    context: z.object({
      interactionId: z.string().min(1).max(256),
      createdAt: z.number().int().nonnegative(),
      prompt: z.string().max(4000),
      questions: z.array(pendingInteractionUserQuestionQuestionSchema).max(USER_QUESTION_MAX_QUESTIONS).optional(),
      lastMessage: z.object({ text: z.string().max(4000), truncated: z.boolean() }).strict().optional()
    }).strict().optional()
  }).strict()
]);
export const MenubarThreadsListResultSchema = z.object({
  agents: z.array(MenubarAgentSchema).max(100),
  needsYou: z.number().int().nonnegative(),
  working: z.number().int().nonnegative()
}).strict();
export const MenubarThreadOpenResultSchema = z.object({ ok: z.boolean(), reason: z.string().optional() }).strict();
export const ThreadQueueTurnResultSchema = z.object({
  ok: z.boolean(),
  queued: z.boolean().optional(),
  reason: z.string().optional()
}).strict();

export const ProjectMutationPatchSchema = z.object({
  name: ProjectNameSchema.optional(),
  color: ProjectColorSchema.optional(),
  icon: z.enum(PROJECT_ICONS).optional(),
  category: z.literal('Extensions').optional()
}).strict().refine((patch) => Object.keys(patch).length > 0, 'project patch must not be empty');

export const ProjectRecordSchema = z.object({
  id: ProjectIdSchema,
  name: ProjectNameSchema,
  path: ProjectPathSchema,
  color: ProjectColorSchema.optional(),
  icon: z.enum(PROJECT_ICONS).optional(),
  createdAt: z.number().int().nonnegative(),
  lastActiveAt: z.number().int().nonnegative(),
  tag: z.string().min(1).max(33).optional(),
  category: z.literal('Extensions').optional()
}).passthrough();

export const ServerRuntimeStartSchema = z.object({
  type: z.literal('start'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  rendererRoot: z.string().min(1),
  dataDir: z.string().min(1),
  hostUrl: z.string().url(),
  hostToken: z.string().min(32),
  hostSigningKey: z.string().min(32),
  hostBinding: z.object({
    hostId: z.string().uuid(),
    instanceId: z.string().uuid()
  }).strict(),
  bundledPluginsRoot: z.string().min(1).optional(),
  /** Desktop UI-signing secret. Sent over the start message, never env: `ps eww` shows a child's initial env to same-uid processes. */
  productServerCredential: z.string().min(32).optional(),
  version: z.string()
}).strict();

/** Longest native-tool-policy (OBL-004) deny reason relayed to a CLI. */
export const NATIVE_TOOL_POLICY_REASON_MAX_CHARS = 1024;
// Without the `u` flag these match UTF-16 code units, so only unpaired halves hit.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const CONTROL_RUN = /[\u0000-\u001f\u007f-\u009f]+/g;

/**
 * Turn any plugin-supplied deny reason into one every CLI still treats as a
 * deny. Codex runs the tool when a deny reason is empty after Rust's
 * `str::trim` — which, unlike JS `trim`, also strips U+0085 — and when
 * serde_json rejects the reply for an escaped lone surrogate. So C0/C1
 * controls become spaces, lone surrogates become U+FFFD, the result is
 * trimmed and capped, and nothing left means `fallback`. The cap can split a
 * surrogate pair, hence the second repair pass. A regex, not ES2024
 * `toWellFormed`, because the repo compiles against lib ES2022.
 */
export function normalizeNativeToolPolicyReason(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const reason = raw
    .slice(0, 4 * NATIVE_TOOL_POLICY_REASON_MAX_CHARS)
    .replace(LONE_SURROGATE, '\ufffd')
    .replace(CONTROL_RUN, ' ')
    .trim()
    .slice(0, NATIVE_TOOL_POLICY_REASON_MAX_CHARS)
    .replace(LONE_SURROGATE, '\ufffd');
  return reason === '' ? fallback : reason;
}

/** JSON chars of one tool call's input, measured on the parsed input the policy judges. */
export const NATIVE_TOOL_POLICY_INPUT_MAX_CHARS = 256 * 1024;
/**
 * UTF-8 bytes of one whole PreToolUse event at the hook route. A limit-sized
 * input is at most 3 bytes per JSON char, so 1 MiB still leaves 256 KiB for
 * the provider's own fields; a bigger event is denied before it is parsed.
 */
export const NATIVE_TOOL_POLICY_EVENT_MAX_BYTES = 1024 * 1024;

/** Whether `input` fits {@link NATIVE_TOOL_POLICY_INPUT_MAX_CHARS}; unserialisable input does not. */
export function nativeToolPolicyInputFits(input: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(input).length <= NATIVE_TOOL_POLICY_INPUT_MAX_CHARS;
  } catch {
    return false;
  }
}

/**
 * One native tool call from a PTY Electron-main owns. Main asserts the
 * identity from its live session record and derives `invocationId`; the
 * server runtime only asks the plugin policy.
 */
export const NativeToolPolicyRequestFieldsSchema = z.object({
  invocationId: z.string().regex(/^[a-f0-9]{64}$/),
  /** The PTY session id main owns; absent for a Modern thread, which has no PTY. */
  sessionId: SessionIdSchema.max(256).optional(),
  /** The thread record the call belongs to; absent for a PTY main has no thread binding for. */
  threadId: SessionIdSchema.max(256).optional(),
  projectId: ProjectIdSchema.max(256),
  profile: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9-]*$/),
  toolName: z.string().min(1).max(512).refine(
    (value) => !/[\x00-\x1f\x7f]/.test(value),
    'tool name must not contain control characters'
  ),
  input: z.record(z.string(), z.unknown()).refine(nativeToolPolicyInputFits, 'tool input exceeds the native tool policy limit')
}).strict();

export const NativeToolPolicyRequestSchema = NativeToolPolicyRequestFieldsSchema.refine(
  (request) => request.sessionId !== undefined || request.threadId !== undefined,
  'a native tool policy request names a session or a thread'
);

/**
 * The plugin policy's answer for one native tool call. A shape check only:
 * {@link normalizeNativeToolPolicyReason} is what guarantees a usable reason.
 */
export const NativeToolPolicyDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('allow') }).strict(),
  z.object({ action: z.literal('deny'), reason: z.string().min(1).max(NATIVE_TOOL_POLICY_REASON_MAX_CHARS) }).strict()
]);

export type NativeToolPolicyRequest = z.infer<typeof NativeToolPolicyRequestSchema>;
export type NativeToolPolicyDecision = z.infer<typeof NativeToolPolicyDecisionSchema>;

/**
 * One PTY dispatch (initial prompt, reply, Job Team task) that Electron-main is
 * about to forward. Main asserts the identity; an unbound PTY has no thread, and
 * a launch has no session until it spawns, so neither id is required.
 */
/** Characters of prompt text main sends for admission; the plugin-facing cap is applied in core. */
export const DISPATCH_ADMISSION_MAIN_PROMPT_MAX_CHARS = 32 * 1024;

export const DispatchAdmissionMainRequestSchema = z.object({
  sessionId: SessionIdSchema.max(256).optional(),
  projectId: ProjectIdSchema.max(256),
  entry: z.enum(['initial', 'reply', 'job-team-dispatch']),
  origin: z.enum(['user', 'agent', 'system']),
  /** Opening or reply text, already bounded by main; core redacts and caps it again before any plugin sees it. */
  prompt: z.object({
    text: z.string().max(DISPATCH_ADMISSION_MAIN_PROMPT_MAX_CHARS),
    truncated: z.boolean().optional()
  }).strict().optional()
}).strict();
export type DispatchAdmissionMainRequest = z.infer<typeof DispatchAdmissionMainRequestSchema>;

/** The admission answer main acts on; a wait is a refusal for a PTY, which cannot hold input. */
export const DispatchAdmissionMainDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('proceed') }).strict(),
  z.object({ action: z.literal('reject'), message: z.string().min(1).max(1024) }).strict(),
  z.object({ action: z.literal('wait'), reason: z.string().min(1).max(1024) }).strict()
]);
export type DispatchAdmissionMainDecision = z.infer<typeof DispatchAdmissionMainDecisionSchema>;

/**
 * Leading text of the error a Modern squad member create returns when dispatch
 * admission refused the start. Nothing was created, so main may release the
 * reserved slot instead of holding it as an uncertain worker.
 */
export const SQUAD_START_REFUSED_PREFIX = 'squad member start refused';

/** The lifecycle moments a PTY session reports to plugins. */
export const PTY_LIFECYCLE_KINDS = ['created', 'active', 'idle', 'failed', 'deleted'] as const;

/**
 * One lifecycle moment of a PTY Electron-main owns. Main asserts the identity
 * from its live session record; the server only fans it out to plugins. A PTY
 * main has no thread binding for names no thread.
 */
export const PtyLifecycleEventMainRequestSchema = z.object({
  kind: z.enum(PTY_LIFECYCLE_KINDS),
  sessionId: SessionIdSchema.max(256),
  /** The thread record the session is bound to; absent for an unbound PTY. */
  threadId: SessionIdSchema.max(256).optional(),
  projectId: ProjectIdSchema.max(256),
  profile: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9-]*$/),
  /** Short failure cause for `failed`; bounded here and redacted again by the server. */
  error: z.string().max(1024).optional()
}).strict();
export type PtyLifecycleEventMainRequest = z.infer<typeof PtyLifecycleEventMainRequestSchema>;

/** Longest raw tool output text main forwards for a settled event; core redacts and caps it again before a plugin sees any. */
export const NATIVE_TOOL_SETTLED_OUTPUT_MAX_CHARS = 32_768;

/**
 * One settled native tool call of a PTY Electron-main owns (OBL-011). Main
 * asserts the identity from its live session record and derives `invocationId`
 * with the same formula as the policy request; the server only fans it out to
 * plugins. Observational: no reply is read.
 */
export const NativeToolSettledMainRequestSchema = z.object({
  invocationId: z.string().regex(/^[a-f0-9]{64}$/),
  sessionId: SessionIdSchema.max(256),
  threadId: SessionIdSchema.max(256).optional(),
  projectId: ProjectIdSchema.max(256),
  profile: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9-]*$/),
  toolName: z.string().min(1).max(512).refine(
    (value) => !/[\x00-\x1f\x7f]/.test(value),
    'tool name must not contain control characters'
  ),
  state: z.enum(['succeeded', 'failed', 'cancelled']),
  durationMs: z.number().int().min(0).max(2_147_483_647),
  exitCode: z.number().int().optional(),
  outputBytes: z.number().int().min(0).optional(),
  output: z.string().max(NATIVE_TOOL_SETTLED_OUTPUT_MAX_CHARS).optional()
}).strict();
export type NativeToolSettledMainRequest = z.infer<typeof NativeToolSettledMainRequestSchema>;

/** Ceiling for the plugin guidance text one PTY launch carries on its argv. */
export const PTY_SESSION_INSTRUCTIONS_MAX_CHARS = 16_000;

/**
 * Ask the plugins for the standing instructions of a PTY main is about to spawn.
 * Main asserts the identity from its own launch plan, never from the renderer.
 * The session is not live yet, so the id is the one main allocated for it.
 */
export const PtySessionInstructionsMainRequestSchema = z.object({
  sessionId: SessionIdSchema.max(256),
  /** The thread record the session will be bound to; absent for an unbound PTY. */
  threadId: SessionIdSchema.max(256).optional(),
  projectId: ProjectIdSchema.max(256),
  profile: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9-]*$/)
}).strict();
export type PtySessionInstructionsMainRequest = z.infer<typeof PtySessionInstructionsMainRequestSchema>;

export const PtySessionInstructionsReplySchema = z.object({
  instructions: z.string().max(PTY_SESSION_INSTRUCTIONS_MAX_CHARS)
}).strict();
export type PtySessionInstructionsReply = z.infer<typeof PtySessionInstructionsReplySchema>;

/** Ceilings for plugin tools one PTY session lists and calls over zcc-inbox. */
export const PTY_SESSION_TOOLS_MAX = 128;
export const PTY_SESSION_TOOL_NAME_MAX_CHARS = 128;
export const PTY_SESSION_TOOL_DESCRIPTION_MAX_CHARS = 4_096;
export const PTY_SESSION_TOOL_RESULT_MAX_CHARS = 256 * 1024;
export const PTY_SESSION_TOOL_IMAGES_MAX = 8;

/**
 * Ask the plugins which tools one live PTY session may use. Main asserts the
 * identity from its live session record, never from the agent or renderer.
 */
export const PtySessionToolsMainRequestSchema = PtySessionInstructionsMainRequestSchema;
export type PtySessionToolsMainRequest = z.infer<typeof PtySessionToolsMainRequestSchema>;

const PtySessionToolNameSchema = z.string().min(1).max(PTY_SESSION_TOOL_NAME_MAX_CHARS).regex(/^[A-Za-z0-9_.-]+$/);

export const PtySessionToolsReplySchema = z.object({
  tools: z.array(z.object({
    name: PtySessionToolNameSchema,
    description: z.string().max(PTY_SESSION_TOOL_DESCRIPTION_MAX_CHARS),
    inputSchema: z.record(z.string(), z.unknown())
  }).strict()).max(PTY_SESSION_TOOLS_MAX)
}).strict();
export type PtySessionToolsReply = z.infer<typeof PtySessionToolsReplySchema>;

/** One plugin tool call from a live PTY session; policy and the plugin both run behind this. */
export const PtySessionToolCallMainRequestSchema = PtySessionInstructionsMainRequestSchema.extend({
  invocationId: z.string().uuid(),
  name: PtySessionToolNameSchema,
  arguments: z.record(z.string(), z.unknown()).refine(nativeToolPolicyInputFits, 'tool input exceeds the native tool policy limit')
}).strict();
export type PtySessionToolCallMainRequest = z.infer<typeof PtySessionToolCallMainRequestSchema>;

export const PtySessionToolCallReplySchema = z.object({
  success: z.boolean(),
  contentItems: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('inputText'), text: z.string().max(PTY_SESSION_TOOL_RESULT_MAX_CHARS) }).strict(),
    z.object({ type: z.literal('inputImage'), imageUrl: z.string().max(8 * 1024 * 1024) }).strict()
  ])).max(1 + PTY_SESSION_TOOL_IMAGES_MAX)
}).strict();
export type PtySessionToolCallReply = z.infer<typeof PtySessionToolCallReplySchema>;

/** Main-attested request for one Modern squad participant. Never renderer input. */
export const SquadMemberRuntimeRequestSchema = z.object({
  bindingId: z.string().uuid(),
  generation: z.number().int().min(1),
  projectId: ProjectIdSchema,
  teamId: z.string().min(1).max(256),
  cohortId: z.string().uuid(),
  executionId: z.string().min(1).max(256).optional(),
  /** Main-resolved, realpath-confined shared worktree. Never renderer input. */
  worktreePath: z.string().min(1).max(32_768).optional(),
  hostId: z.string().uuid().optional(),
  nativeToolPolicyRequired: z.boolean().optional(),
  providerId: z.string().min(1).max(128),
  role: z.enum(['worker', 'orchestrator']),
  prompt: z.string().min(1).max(64 * 1024),
  title: z.string().min(1).max(120),
  model: z.string().min(1).max(256).optional(),
  reasoningLevel: z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'ultra', 'max', 'ultracode']).optional(),
  permissionMode: z.enum(['accept-edits', 'auto', 'full']).optional(),
  /** Main-authorized automated catalog selection. Never renderer input. */
  automatedSkillIds: z.array(z.string().min(1).max(256)).max(64).optional(),
  /** Main-authorized user/plugin skill names (allowlist entries matching no catalog id). Never renderer input. */
  allowedSkillNames: z.array(z.string().min(1).max(256)).max(64).optional()
}).strict();
export type SquadMemberRuntimeRequest = z.infer<typeof SquadMemberRuntimeRequestSchema>;

export const SquadMemberControlRequestSchema = z.object({
  bindingId: z.string().uuid(),
  generation: z.number().int().min(1),
  projectId: ProjectIdSchema
}).strict();
export type SquadMemberControlRequest = z.infer<typeof SquadMemberControlRequestSchema>;

/** Main-signed Modern resume of a confirmed-stopped member on its stored provider thread. */
export const SquadMemberResumeRequestSchema = z.object({
  bindingId: z.string().uuid(),
  projectId: ProjectIdSchema,
  expectedGeneration: z.number().int().min(1),
  newGeneration: z.number().int().min(2),
  expectedProviderThreadId: z.string().min(1).max(512)
}).strict();
export type SquadMemberResumeRequest = z.infer<typeof SquadMemberResumeRequestSchema>;
export const SquadMemberResumeResultSchema = z.object({
  bindingId: z.string().uuid(),
  projectId: ProjectIdSchema,
  generation: z.number().int().min(2),
  providerThreadId: z.string().min(1).max(512)
}).strict();
export type SquadMemberResumeResult = z.infer<typeof SquadMemberResumeResultSchema>;

export const SquadMemberStatusSchema = SquadMemberControlRequestSchema.extend({
  live: z.boolean(),
  status: z.enum(['starting', 'active', 'idle', 'stopping', 'error', 'stopped', 'unknown']),
  hostOnline: z.boolean(),
  providerStarted: z.boolean(),
  /** Provider session id; main-only (native ids never reach the renderer). */
  providerThreadId: z.string().min(1).max(512).optional(),
  /** Start-time provider-reported restore support recorded in binding metadata. */
  sessionRestorable: z.boolean().optional(),
  eventSequence: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
}).strict();
export type SquadMemberStatus = z.infer<typeof SquadMemberStatusSchema>;

export const SquadRuntimePreflightRequestSchema = z.object({
  projectId: ProjectIdSchema,
  hostId: z.string().uuid().optional(),
  providerIds: z.array(z.string().min(1).max(128)).min(1).max(32),
  selections: z.array(z.object({ providerId: z.string().min(1).max(128), model: z.string().min(1).max(256).optional(),
    permissionMode: z.enum(['accept-edits', 'auto', 'full']).optional() }).strict()).max(32).optional(),
  nativeToolPolicyRequired: z.boolean().optional()
}).strict();
export type SquadRuntimePreflightRequest = z.infer<typeof SquadRuntimePreflightRequestSchema>;
export const SquadRuntimePreflightResultSchema = z.object({
  ready: z.boolean(),
  hostId: z.string().uuid(),
  policyInventoryReady: z.boolean(),
  nativeToolPolicyRequired: z.boolean(),
  nativeToolPolicyWired: z.boolean(),
  reason: z.string().max(1024).optional(),
  providers: z.array(z.object({
    providerId: z.string().min(1).max(128),
    available: z.boolean(),
    reason: z.string().max(1024).optional()
  }).strict()).max(32)
}).strict();
export type SquadRuntimePreflightResult = z.infer<typeof SquadRuntimePreflightResultSchema>;

/** Main-attested assignment delivery. Acceptance never implies task completion. */
export const SquadMemberDeliveryRequestSchema = SquadMemberControlRequestSchema.extend({
  assignmentId: z.string().min(1).max(256),
  idempotencyKey: z.string().min(1).max(256),
  message: z.string().min(1).max(64 * 1024)
}).strict();
export type SquadMemberDeliveryRequest = z.infer<typeof SquadMemberDeliveryRequestSchema>;
export const SquadMemberDeliveryResultSchema = SquadMemberControlRequestSchema.extend({
  assignmentId: z.string().min(1).max(256),
  idempotencyKey: z.string().min(1).max(256),
  state: z.enum(['accepted', 'completed', 'uncertain', 'rejected']),
  reason: z.string().max(1024).optional()
}).strict();
export type SquadMemberDeliveryResult = z.infer<typeof SquadMemberDeliveryResultSchema>;
/** Main sends this only after its authenticated work report settles the ledger. */
export const SquadMemberDeliveryCompletionSchema = SquadMemberControlRequestSchema.extend({
  assignmentId: z.string().min(1).max(256),
  idempotencyKey: z.string().min(1).max(256)
}).strict();
export type SquadMemberDeliveryCompletion = z.infer<typeof SquadMemberDeliveryCompletionSchema>;

/** Authenticated development transport uses exactly the trusted IPC payloads. */
export const SquadRuntimeOperationSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('squad-runtime-preflight'), request: SquadRuntimePreflightRequestSchema }).strict(),
  z.object({ operation: z.literal('squad-member-create'), request: SquadMemberRuntimeRequestSchema }).strict(),
  z.object({ operation: z.literal('squad-member-activate'), request: SquadMemberRuntimeRequestSchema }).strict(),
  z.object({ operation: z.literal('squad-member-deliver'), request: SquadMemberDeliveryRequestSchema }).strict(),
  z.object({ operation: z.literal('squad-member-delivery-complete'), request: SquadMemberDeliveryCompletionSchema }).strict(),
  z.object({ operation: z.literal('squad-member-status'), request: SquadMemberControlRequestSchema }).strict(),
  z.object({ operation: z.literal('squad-member-stop'), request: SquadMemberControlRequestSchema }).strict(),
  z.object({ operation: z.literal('squad-member-resume'), request: SquadMemberResumeRequestSchema }).strict()
]);
export const SQUAD_RUNTIME_OPERATION_PATH = '/internal/main/squad-runtime';

const ServerRuntimeRequestBaseSchema = z.object({
  type: z.literal('request'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  id: RequestIdSchema,
  deadlineAt: DeadlineSchema
}).strict();

export const ServerRuntimeRequestSchema = z.discriminatedUnion('operation', [
  ServerRuntimeRequestBaseSchema.extend({ operation: z.literal('project-metadata'), request: ProjectMetadataRequestSchema }).strict(),
  ServerRuntimeRequestBaseSchema.extend({ operation: z.literal('project-catalogs'), request: ProjectCatalogRequestSchema }).strict(),
  ServerRuntimeRequestBaseSchema.extend({ operation: z.literal('project-feed'), request: ProjectFeedRequestSchema }).strict(),
  ServerRuntimeRequestBaseSchema.extend({ operation: z.literal('cli-discovery'), request: CliDiscoveryRequestSchema }).strict(),
  ServerRuntimeRequestBaseSchema.extend({ operation: z.literal('cli-callback-grant'), request: CliCallbackControlSchema }).strict(),
  ServerRuntimeRequestBaseSchema.extend({ operation: z.literal('project-history'), request: ProjectHistoryRequestSchema }).strict(),
  ServerRuntimeRequestBaseSchema.extend({ operation: z.literal('library-agent'), request: LibraryAgentRequestSchema }).strict(),
  ServerRuntimeRequestBaseSchema.extend({ operation: z.literal('library-document'), request: LibraryDocumentRequestSchema }).strict(),
  ServerRuntimeRequestBaseSchema.extend({ operation: z.literal('app-version') }).strict(),
  ServerRuntimeRequestBaseSchema.extend({ operation: z.literal('projects-list') }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('projects-add'),
    path: ProjectPathSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('menubar-threads-list'),
    limit: z.number().int().min(1).max(100)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('menubar-thread-open'),
    threadId: z.string().min(1).max(256),
    projectId: ProjectIdSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('squad-runtime-preflight'),
    request: SquadRuntimePreflightRequestSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('squad-member-create'),
    request: SquadMemberRuntimeRequestSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('squad-member-activate'),
    request: SquadMemberRuntimeRequestSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('squad-member-deliver'),
    request: SquadMemberDeliveryRequestSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('squad-member-delivery-complete'),
    request: SquadMemberDeliveryCompletionSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('squad-member-status'),
    request: SquadMemberControlRequestSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('squad-member-stop'),
    request: SquadMemberControlRequestSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('squad-member-resume'),
    request: SquadMemberResumeRequestSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('projects-update'),
    projectId: ProjectIdSchema,
    patch: ProjectMutationPatchSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('projects-reorder'),
    orderedIds: z.array(ProjectIdSchema).max(10_000)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('projects-touch'),
    projectId: ProjectIdSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('projects-remove'),
    projectId: ProjectIdSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('product-event'),
    channel: z.string().refine(value => value === 'product:reset' || value === 'library:changed' || [...SHARED_PRODUCT_EVENTS.values()].includes(value)),
    args: z.array(z.unknown()).max(PRODUCT_EVENT_ARGS_MAX_COUNT).refine(value => JSON.stringify(value).length <= PRODUCT_EVENT_ARGS_MAX_CHARS)
  }).strict().refine(value => !['product:reset', 'library:changed'].includes(value.channel) || value.args.length === 0, 'Invalidations cannot contain snapshots'),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('project-settings-get'),
    projectId: ProjectIdSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('named-checks-get'),
    scope: NamedCheckScopeSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('named-checks-set'),
    scope: NamedCheckScopeSchema,
    checks: NamedChecksSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('project-settings-set'),
    projectId: ProjectIdSchema,
    patch: ProjectSettingsPatchSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('terminal-execute'),
    command: TerminalRequestCommandSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('terminal-record'),
    event: TerminalHostEventSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('terminal-events-since'),
    sessionId: SessionIdSchema,
    afterSequence: z.number().int().min(-1).optional()
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    // Liveness probe for a Modern (ACP) conversation thread acting as a team
    // launcher. Electron-main asks the server-runtime whether this threadId is a
    // live thread in this project before honoring a loopback launch_team call —
    // the ACP analogue of the pty getSession() check (a credential proves
    // "trusted local process", not liveness).
    operation: z.literal('thread-live'),
    threadId: z.string().min(1).max(256),
    projectId: ProjectIdSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    // Queue a text turn into a live Modern (ACP) thread (sent now when idle,
    // deferred behind the active turn otherwise).
    operation: z.literal('thread-queue-turn'),
    threadId: z.string().min(1).max(256),
    projectId: ProjectIdSchema,
    text: z.string().min(1).max(4096)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-list')
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugin-packs-list')
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugin-packs-installed')
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugin-packs-plan'),
    identity: pluginPackIdentitySchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugin-packs-install'),
    request: pluginPackInstallRequestSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugin-packs-forget'),
    identity: pluginPackIdentitySchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-install'),
    source: z.string().min(1).max(4096)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-enable'),
    pluginId: z.string().min(1).max(128)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-disable'),
    pluginId: z.string().min(1).max(128)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-remove'),
    pluginId: z.string().min(1).max(128)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-repair'),
    pluginId: z.string().min(1).max(128),
    path: z.string().min(1).max(4096).optional()
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-reload'),
    pluginId: z.string().min(1).max(128)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-logs'),
    pluginId: z.string().min(1).max(128),
    n: z.number().int().min(1).max(10_000).optional()
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-snapshot')
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-search'),
    query: z.string().max(256).optional()
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-update-all')
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-outdated')
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-update'),
    pluginId: z.string().min(1).max(128)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-call-rpc'),
    pluginId: z.string().min(1).max(128),
    method: z.string().min(1).max(128),
    args: z.unknown().optional()
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-settings-get'),
    pluginId: z.string().min(1).max(128)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-settings-set'),
    pluginId: z.string().min(1).max(128),
    values: z.record(z.string(), z.union([z.string(), z.boolean(), z.null()])).optional()
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-cli-contributions')
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-cli-run'),
    pluginId: z.string().min(1).max(128),
    argv: z.array(z.string().max(16_384)).max(256).optional(),
    projectId: z.string().min(1).max(128).optional(),
    threadId: z.string().min(1).max(128).optional(),
    cwd: z.string().min(1).max(4096).optional()
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    // OBL-004 for PTYs Electron-main owns: the product server never registers
    // them, so main asserts the live session's identity on this channel.
    operation: z.literal('plugins-tool-policy'),
    request: NativeToolPolicyRequestSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    // Admission for PTY input main owns: the server holds the plugin handlers.
    operation: z.literal('plugins-dispatch-admission'),
    request: DispatchAdmissionMainRequestSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    // OBL-011: a settled native tool call of a PTY main owns; observational.
    operation: z.literal('plugins-tool-settled'),
    request: NativeToolSettledMainRequestSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    // Lifecycle moments of PTYs main owns: the server holds the plugin handlers.
    operation: z.literal('plugins-pty-lifecycle-event'),
    request: PtyLifecycleEventMainRequestSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    // Plugin guidance for a PTY main is about to spawn: the server holds the plugin handlers.
    operation: z.literal('plugins-pty-session-instructions'),
    request: PtySessionInstructionsMainRequestSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    // Plugin tools one live PTY session may list: the server holds the plugin handlers.
    operation: z.literal('plugins-pty-session-tools'),
    request: PtySessionToolsMainRequestSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    // One plugin tool call from a live PTY session: tool policy, then the plugin.
    operation: z.literal('plugins-pty-session-tool-call'),
    request: PtySessionToolCallMainRequestSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    // OBL-018 pre-spawn readiness: main reads the tool-policy inventory before a
    // provider launch to decide whether the native-tool veto must be reachable.
    operation: z.literal('plugins-tool-policy-inventory')
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('marketplace-list')
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('marketplace-add'),
    url: z.string().min(1).max(4096)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('marketplace-refresh'),
    url: z.string().min(1).max(4096)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('marketplace-remove'),
    url: z.string().min(1).max(4096)
  }).strict()
]);

export const RuntimeStopSchema = z.object({
  type: z.literal('stop'),
  protocolVersion: ServerRuntimeProtocolVersionSchema
}).strict();

/**
 * One-way push: Electron-main's loopback MCP HTTP server is bound AFTER the
 * server-runtime child forks (its port isn't known at start), so its base URL
 * can't ride the start payload. Sent once after `startMcpServer` resolves so the
 * Modern team-launch / owner-execution forwarder can reach it.
 * `teamLaunchEnabled` gates launch_team; `teamJobLaunchEnabled` gates
 * execution.start / snapshot / resume_binding. Off ⇒ those tools stay hidden.
 */
export const RuntimeMcpReadySchema = z.object({
  type: z.literal('mcp-ready'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  mcpBaseUrl: z.string().url(),
  teamLaunchEnabled: z.boolean(),
  teamJobLaunchEnabled: z.boolean().optional()
}).strict();

/** Product registry identity, learned after the private terminal transport boots. */
const RuntimeLocalHostSchema = z.object({
  type: z.literal('local-host'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  hostId: z.string().uuid()
}).strict();

export const ServerRuntimeInboundSchema = z.discriminatedUnion('type', [
  ServerRuntimeStartSchema,
  ServerRuntimeRequestSchema,
  RuntimeStopSchema,
  RuntimeMcpReadySchema,
  RuntimeLocalHostSchema
]);

export const RuntimeReadySchema = z.object({
  type: z.literal('ready'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  url: z.string().url()
}).strict();
export const RuntimeResultSchema = z.object({
  type: z.literal('result'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  id: RequestIdSchema,
  value: z.unknown()
}).strict();
export const RuntimeErrorSchema = z.object({
  type: z.literal('error'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  message: z.string().min(1),
  /** Present when the failure is an expected domain error (see rpc-error.ts). */
  code: z.string().min(1).max(64).optional(),
  id: RequestIdSchema.optional()
}).strict();
export const RuntimeStoppedSchema = z.object({
  type: z.literal('stopped'),
  protocolVersion: ServerRuntimeProtocolVersionSchema
}).strict();
export const HostTerminalEventMessageSchema = z.object({
  type: z.literal('terminal-event'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  event: TerminalHostEventSchema
}).strict();
export const ProjectSettingsChangedMessageSchema = z.object({
  type: z.literal('project-settings-changed'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  projectId: ProjectIdSchema
}).strict();
export const MenubarThreadsChangedMessageSchema = z.object({
  type: z.literal('menubar-threads-changed'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  localThreadsWorking: z.boolean()
}).strict();

const PluginCapabilityMcpServerSchema = z.object({
  name: z.string().min(1).max(64),
  type: z.string().min(1).max(32),
  command: z.string().max(256).optional(),
  args: z.array(z.string().max(4096)).max(32).optional(),
  url: z.string().max(4096).optional(),
  env: z.record(z.string().max(256), z.string().max(4096)).optional(),
  alwaysOn: z.boolean().optional()
}).strict();

export const PluginAgentContributionSchema = z.object({
  id: z.string().min(1).max(128),
  enabled: z.boolean(),
  rootDir: z.string().min(1).max(32_768),
  skillsRootPaths: z.array(z.string().max(1024)).max(20),
  skillNames: z.array(z.string().max(64)).max(20),
  mcpServers: z.array(PluginCapabilityMcpServerSchema).max(32),
  extra: z.record(z.string(), z.unknown()).optional()
}).strict();

export const PluginCapabilitiesChangedMessageSchema = z.object({
  type: z.literal('plugin-capabilities'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  contributors: z.array(PluginAgentContributionSchema).max(256)
}).strict();

const PluginAppProjectTabSchema = z.object({
  label: z.string().min(1).max(256).optional(),
  icon: z.string().min(1).max(256).optional(),
  order: z.number().int().optional(),
  global: z.boolean().optional()
}).strict();

export const PluginAppSnapshotSchema = z.object({
  id: PluginIdSchema,
  name: z.string().min(1).max(256),
  description: z.string().max(4096),
  icon: z.string().min(1).max(256),
  enabled: z.boolean(),
  provenance: z.enum(['builtin', 'direct', 'catalog']),
  sourceKind: z.enum(['builtin', 'path', 'git', 'npm']).optional(),
  sourceRecovery: z.object({ canLocate: z.boolean(), canSwitchOfficial: z.boolean() }).strict().optional(),
  collection: z.literal('coding-agents').optional(),
  status: z.enum(['running', 'disabled', 'degraded', 'needs-configuration']),
  statusDetail: z.string().max(4096).nullable().optional(),
  appUrl: z.string().max(4096).nullable(),
  availableVersion: z.string().min(1).max(256).optional(),
  updatePolicy: z.enum(['bundled', 'local', 'independent', 'migration-required']).optional(),
  updateCheck: z.object({
    checkedAt: z.number().finite(),
    outcome: z.enum(['current', 'available', 'pinned', 'incompatible', 'unavailable']),
    detail: z.string().max(1024).optional(),
    blocked: z.object({ version: z.string().max(256), reasons: z.array(z.string().max(1024)).max(8) }).optional()
  }).strict().optional(),
  projectTab: PluginAppProjectTabSchema.optional(),
  peers: z.boolean().optional(),
  toolPolicyTimeoutMs: z.number().int().min(1_000).max(9_000).optional(),
  skillNames: z.array(z.string().min(1).max(256)).max(64).optional(),
  mcpServers: z.array(z.object({
    name: z.string().min(1).max(256),
    type: z.string().min(1).max(64)
  }).passthrough()).max(32).optional(),
  cliNames: z.array(z.string().min(1).max(256)).max(32).optional()
}).strict();

export const PluginAppsChangedMessageSchema = z.object({
  type: z.literal('plugin-apps-changed'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  apps: z.array(PluginAppSnapshotSchema).max(256)
}).strict();

export const RuntimeOutboundSchema = z.discriminatedUnion('type', [
  RuntimeReadySchema,
  RuntimeResultSchema,
  RuntimeErrorSchema,
  RuntimeStoppedSchema,
  HostTerminalEventMessageSchema,
  z.object({ type: z.literal('library-changed'), protocolVersion: ServerRuntimeProtocolVersionSchema }).strict(),
  z.object({ type: z.literal('projects-changed'), protocolVersion: ServerRuntimeProtocolVersionSchema }).strict(),
  ProjectSettingsChangedMessageSchema,
  MenubarThreadsChangedMessageSchema,
  PluginCapabilitiesChangedMessageSchema,
  PluginAppsChangedMessageSchema
]);

export type ServerRuntimeInbound = z.infer<typeof ServerRuntimeInboundSchema>;
export type RuntimeOutbound = z.infer<typeof RuntimeOutboundSchema>;
