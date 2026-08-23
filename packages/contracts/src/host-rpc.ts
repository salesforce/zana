import { z } from 'zod';
import {
  discoveredWorkspacePropertiesSchema,
  environmentStatusSchema,
  gitHostPullRequestMergeMethodSchema,
  gitHostPullRequestSchema,
  provisioningTranscriptEntrySchema,
  workspaceDiffResponseSchema,
  workspaceDiffTargetSchema,
  workspaceFileStatusSchema,
  workspaceProvisionTypeSchema,
  workspaceStatusSchema
} from '@zana-ai/zcc-domain';
import { gitBranchNameSchema } from '@zana-ai/zcc-domain/git-checkout';

/**
 * Bump when any enroll payload, daemon WS message, host-rpc command, or host
 * event envelope changes shape or meaning. Mismatch fails before dispatch.
 */
export const HOST_RPC_PROTOCOL_VERSION = 5;
const ProtocolVersionSchema = z.literal(HOST_RPC_PROTOCOL_VERSION);

const UuidSchema = z.string().uuid();
const RequestIdSchema = z.string().min(1).max(128);
const HostNameSchema = z.string().min(1).max(200);
const PathSchema = z.string().min(1).max(4096);
const RelPathSchema = z.string().min(1).max(1024);

export const HostRpcCommandTypeSchema = z.enum([
  'provider.status',
  'environment.provision',
  'environment.provision.cancel',
  'environment.destroy',
  'thread.start',
  'thread.resize',
  'thread.input',
  'thread.stop',
  'thread.resume',
  'turn.submit',
  'host.list_files',
  'host.list_dir',
  'host.read_file',
  'host.list_branches',
  'workspace.status',
  'workspace.diff',
  'workspace.diffFiles',
  'workspace.diffPatch',
  'workspace.commit',
  'workspace.squash_merge',
  'workspace.pull_request',
  'workspace.pull_request_ready',
  'workspace.pull_request_draft',
  'workspace.pull_request_merge',
  'workspace.pull_request_create',
  'project.clone',
  'project.clone_default_path',
  'codex.voice.transcribe'
]);
export type HostRpcCommandType = z.infer<typeof HostRpcCommandTypeSchema>;

export const workspaceContextSchema = z.object({
  workspacePath: PathSchema,
  workspaceProvisionType: workspaceProvisionTypeSchema
}).strict();
export type WorkspaceContext = z.infer<typeof workspaceContextSchema>;

export const ProviderStatusCommandSchema = z.object({
  type: z.literal('provider.status')
}).strict();

const unmanagedCheckoutSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('existing'),
    name: gitBranchNameSchema
  }).strict(),
  z.object({
    kind: z.literal('new'),
    name: gitBranchNameSchema,
    baseBranch: gitBranchNameSchema
  }).strict()
]);

const provisionInitiatorSchema = z.object({
  threadId: UuidSchema,
  provisioningId: z.string().min(1)
}).strict();

const environmentProvisionBaseSchema = z.object({
  type: z.literal('environment.provision'),
  environmentId: UuidSchema,
  initiator: provisionInitiatorSchema.nullable().optional()
});

export const EnvironmentProvisionCommandSchema = z.discriminatedUnion('workspaceProvisionType', [
  environmentProvisionBaseSchema.extend({
    workspaceProvisionType: z.literal('unmanaged'),
    path: PathSchema,
    checkout: unmanagedCheckoutSchema.optional()
  }).strict(),
  environmentProvisionBaseSchema.extend({
    workspaceProvisionType: z.literal('managed-worktree'),
    sourcePath: PathSchema,
    targetPath: PathSchema,
    branchName: gitBranchNameSchema,
    baseBranch: gitBranchNameSchema.nullable(),
    setupTimeoutMs: z.number().int().positive()
  }).strict(),
  environmentProvisionBaseSchema.extend({
    workspaceProvisionType: z.literal('personal'),
    targetPath: PathSchema
  }).strict()
]);
export type EnvironmentProvisionCommand = z.infer<typeof EnvironmentProvisionCommandSchema>;

export const EnvironmentProvisionCancelCommandSchema = z.object({
  type: z.literal('environment.provision.cancel'),
  environmentId: UuidSchema
}).strict();

export const EnvironmentDestroyCommandSchema = workspaceContextSchema.extend({
  type: z.literal('environment.destroy'),
  environmentId: UuidSchema
}).strict();

const threadLaunchPersonaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseProfile: z.string().min(1).optional(),
  model: z.string().optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'plan', 'bypassPermissions']).optional(),
  appendSystemPrompt: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()).optional(),
  addDirs: z.array(z.string()).optional(),
  mcpServers: z.array(z.string()).optional(),
  initialPrompt: z.string().optional()
}).strict();

const threadLaunchRemoteSchema = z.object({
  host: z.string().min(1).max(200),
  user: z.string().min(1).max(200).optional(),
  remotePath: PathSchema.optional(),
  proxyJump: z.string().min(1).max(500).optional()
}).strict();

const threadLaunchCohortSchema = z.object({
  cohortId: z.string().min(1),
  teamId: z.string().min(1),
  teamName: z.string().min(1),
  role: z.enum(['orchestrator', 'worker']),
  slotLabel: z.string().max(120).optional(),
  slotId: z.string().max(120).optional()
}).strict();

export const HostBridgeLaunchSchema = z.object({
  pluginId: z.string().min(1),
  dataDir: PathSchema,
  source: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('artifact'),
      digest: z.string().min(1),
      artifactPath: PathSchema
    }).strict(),
    z.object({
      kind: z.literal('daemon-bundled'),
      id: z.string().min(1)
    }).strict()
  ]),
  capabilities: z.object({
    supportsServiceTier: z.boolean(),
    permissionModes: z.array(z.string().min(1)).min(1),
    supportsThreadArchive: z.boolean(),
    supportsThreadRename: z.boolean(),
    fork: z.string().min(1)
  }).strict()
}).strict();
export type HostBridgeLaunch = z.infer<typeof HostBridgeLaunchSchema>;

export const ThreadStartCommandSchema = z.object({
  type: z.literal('thread.start'),
  threadId: UuidSchema,
  environmentId: UuidSchema,
  projectId: z.string().min(1),
  providerId: z.string().min(1),
  input: z.array(z.string()).default([]),
  cwd: PathSchema.optional(),
  title: z.string().max(200).optional(),
  extraArgs: z.array(z.string().max(4000)).max(64).optional(),
  harnessRouting: z.unknown().optional(),
  persona: threadLaunchPersonaSchema.optional(),
  headless: z.boolean().optional(),
  scheduled: z.boolean().optional(),
  autoCloseOnFinish: z.boolean().optional(),
  inboxLevel: z.enum(['silent', 'quiet', 'loud']).optional(),
  autonomous: z.boolean().optional(),
  resumeSessionId: z.string().min(1).optional(),
  environment: z.enum(['local', 'sandbox', 'microvm']).optional(),
  sandboxDenyNetwork: z.boolean().optional(),
  microVmImage: z.string().max(200).optional(),
  microVmCpus: z.number().int().positive().max(32).optional(),
  microVmMemoryMib: z.number().int().positive().max(65536).optional(),
  remote: threadLaunchRemoteSchema.optional(),
  reconnectTmuxId: UuidSchema.optional(),
  resume: z.boolean().optional(),
  cohort: threadLaunchCohortSchema.optional(),
  /** AgentRuntime provider bridge. Present on the Thread path; absent keeps PTY-shaped tests working. */
  bridgeLaunch: HostBridgeLaunchSchema.optional(),
  permissionMode: z.enum(['accept-edits', 'auto', 'full']).optional(),
  model: z.string().min(1).max(200).optional(),
  providerThreadId: z.string().min(1).optional()
}).strict();

export const ThreadResizeCommandSchema = z.object({
  type: z.literal('thread.resize'),
  threadId: UuidSchema,
  cols: z.number().int().min(20).max(300),
  rows: z.number().int().min(8).max(100)
}).strict();

export const ThreadInputCommandSchema = z.object({
  type: z.literal('thread.input'),
  threadId: UuidSchema,
  data: z.string().max(64 * 1024)
}).strict();

export const ThreadStopCommandSchema = z.object({
  type: z.literal('thread.stop'),
  threadId: UuidSchema
}).strict();

export const TurnSubmitCommandSchema = z.object({
  type: z.literal('turn.submit'),
  threadId: UuidSchema,
  environmentId: UuidSchema,
  input: z.array(z.string().min(1)).min(1),
  mode: z.enum(['start', 'auto', 'steer', 'queue-if-active', 'steer-if-active']).optional()
}).strict();

export const ThreadResumeCommandSchema = z.object({
  type: z.literal('thread.resume'),
  threadId: UuidSchema,
  environmentId: UuidSchema,
  projectId: z.string().min(1),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1),
  cwd: PathSchema.optional(),
  bridgeLaunch: HostBridgeLaunchSchema.optional(),
  permissionMode: z.enum(['accept-edits', 'auto', 'full']).optional(),
  model: z.string().min(1).max(200).optional()
}).strict();

export const HostListFilesCommandSchema = z.object({
  type: z.literal('host.list_files'),
  roots: z.array(PathSchema).min(1).max(64)
}).strict();

/** Empty relPath lists the authorized root itself. */
export const HostListDirCommandSchema = z.object({
  type: z.literal('host.list_dir'),
  root: PathSchema,
  relPath: z.string().max(1024)
}).strict();

export const HostReadFileCommandSchema = z.object({
  type: z.literal('host.read_file'),
  root: PathSchema,
  relPath: RelPathSchema
}).strict();

export const HostListBranchesCommandSchema = workspaceContextSchema.extend({
  type: z.literal('host.list_branches'),
  query: z.string().max(200).optional(),
  limit: z.number().int().positive().max(500).optional()
}).strict();

export const WorkspaceStatusCommandSchema = workspaceContextSchema.extend({
  type: z.literal('workspace.status'),
  mergeBaseBranch: gitBranchNameSchema.optional(),
  maxUntrackedLineStatFiles: z.number().int().positive().optional(),
  maxUntrackedLineStatBytes: z.number().int().positive().optional()
}).strict();

export const WorkspaceDiffCommandSchema = workspaceContextSchema.extend({
  type: z.literal('workspace.diff'),
  target: workspaceDiffTargetSchema,
  maxDiffBytes: z.number().int().positive().optional(),
  maxFileListBytes: z.number().int().positive().optional(),
  maxUntrackedFiles: z.number().int().positive().optional()
}).strict();

export const WorkspaceDiffFilesCommandSchema = workspaceContextSchema.extend({
  type: z.literal('workspace.diffFiles'),
  target: workspaceDiffTargetSchema,
  maxFiles: z.number().int().positive().optional()
}).strict();

export const WorkspaceDiffPatchCommandSchema = workspaceContextSchema.extend({
  type: z.literal('workspace.diffPatch'),
  target: workspaceDiffTargetSchema,
  paths: z.array(z.string().min(1)).min(1).max(64),
  maxBytesPerFile: z.number().int().positive().optional()
}).strict();

export const WorkspaceCommitCommandSchema = workspaceContextSchema.extend({
  type: z.literal('workspace.commit'),
  message: z.string().min(1).max(2000),
  noVerify: z.boolean().optional()
}).strict();

export const WorkspaceSquashMergeCommandSchema = workspaceContextSchema.extend({
  type: z.literal('workspace.squash_merge'),
  targetBranch: gitBranchNameSchema,
  message: z.string().min(1).max(2000)
}).strict();

export const WorkspacePullRequestCommandSchema = workspaceContextSchema.extend({
  type: z.literal('workspace.pull_request')
}).strict();

export const WorkspacePullRequestReadyCommandSchema = workspaceContextSchema.extend({
  type: z.literal('workspace.pull_request_ready')
}).strict();

export const WorkspacePullRequestDraftCommandSchema = workspaceContextSchema.extend({
  type: z.literal('workspace.pull_request_draft')
}).strict();

export const WorkspacePullRequestMergeCommandSchema = workspaceContextSchema.extend({
  type: z.literal('workspace.pull_request_merge'),
  method: gitHostPullRequestMergeMethodSchema
}).strict();

export const WorkspacePullRequestCreateCommandSchema = workspaceContextSchema.extend({
  type: z.literal('workspace.pull_request_create'),
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(4000).optional(),
  base: gitBranchNameSchema.optional(),
  draft: z.boolean().optional()
}).strict();

export const ProjectCloneCommandSchema = z.object({
  type: z.literal('project.clone'),
  remoteUrl: z.string().min(1).max(2048),
  projectSlug: z.string().min(1).max(120),
  targetPath: PathSchema.optional()
}).strict();

export const ProjectCloneDefaultPathCommandSchema = z.object({
  type: z.literal('project.clone_default_path'),
  projectSlug: z.string().min(1).max(120)
}).strict();

export const CodexVoiceTranscribeCommandSchema = z.object({
  type: z.literal('codex.voice.transcribe'),
  model: z.string().min(1).max(120),
  audioBase64: z.string().min(1),
  mimeType: z.string().min(1).max(200),
  filename: z.string().min(1).max(200),
  prompt: z.string().max(4000).nullable(),
  timeoutMs: z.number().int().positive().max(60_000)
}).strict();
export type CodexVoiceTranscribeCommand = z.infer<typeof CodexVoiceTranscribeCommandSchema>;

export const HostRpcCommandSchema = z.union([
  ProviderStatusCommandSchema,
  EnvironmentProvisionCommandSchema,
  EnvironmentProvisionCancelCommandSchema,
  EnvironmentDestroyCommandSchema,
  ThreadStartCommandSchema,
  ThreadResizeCommandSchema,
  ThreadInputCommandSchema,
  ThreadStopCommandSchema,
  ThreadResumeCommandSchema,
  TurnSubmitCommandSchema,
  HostListFilesCommandSchema,
  HostListDirCommandSchema,
  HostReadFileCommandSchema,
  HostListBranchesCommandSchema,
  WorkspaceStatusCommandSchema,
  WorkspaceDiffCommandSchema,
  WorkspaceDiffFilesCommandSchema,
  WorkspaceDiffPatchCommandSchema,
  WorkspaceCommitCommandSchema,
  WorkspaceSquashMergeCommandSchema,
  WorkspacePullRequestCommandSchema,
  WorkspacePullRequestReadyCommandSchema,
  WorkspacePullRequestDraftCommandSchema,
  WorkspacePullRequestMergeCommandSchema,
  WorkspacePullRequestCreateCommandSchema,
  ProjectCloneCommandSchema,
  ProjectCloneDefaultPathCommandSchema,
  CodexVoiceTranscribeCommandSchema
]);
export type HostRpcCommand = z.infer<typeof HostRpcCommandSchema>;

const ProviderStatusEntrySchema = z.object({
  family: z.string().min(1),
  label: z.string().min(1),
  binary: z.string().min(1),
  enabled: z.boolean(),
  alwaysEnabled: z.boolean(),
  installed: z.boolean(),
  version: z.string().optional(),
  normalizedVersion: z.string().optional(),
  installHint: z.string().min(1),
  defaultProfileId: z.string().optional(),
  agentDefaultEligible: z.boolean().optional()
}).strict();

export const ProviderStatusResultSchema = z.object({
  providers: z.array(ProviderStatusEntrySchema)
}).strict();
export type ProviderStatusResult = z.infer<typeof ProviderStatusResultSchema>;

export const EnvironmentProvisionResultSchema = discoveredWorkspacePropertiesSchema.extend({
  environmentId: UuidSchema,
  transcript: z.array(provisioningTranscriptEntrySchema)
}).strict();
export type EnvironmentProvisionResult = z.infer<typeof EnvironmentProvisionResultSchema>;

export const EnvironmentProvisionCancelResultSchema = z.object({
  environmentId: UuidSchema,
  cancelled: z.literal(true)
}).strict();

export const EnvironmentDestroyResultSchema = z.object({
  environmentId: UuidSchema,
  destroyed: z.literal(true)
}).strict();

export const ThreadStartResultSchema = z.object({
  threadId: UuidSchema,
  started: z.literal(true),
  providerThreadId: z.string().min(1).optional()
}).strict();
export type ThreadStartResult = z.infer<typeof ThreadStartResultSchema>;

export const ThreadResizeResultSchema = z.object({
  threadId: UuidSchema,
  resized: z.literal(true)
}).strict();
export type ThreadResizeResult = z.infer<typeof ThreadResizeResultSchema>;

export const ThreadInputResultSchema = z.object({
  threadId: UuidSchema,
  accepted: z.literal(true)
}).strict();
export type ThreadInputResult = z.infer<typeof ThreadInputResultSchema>;

export const ThreadStopResultSchema = z.object({
  threadId: UuidSchema,
  stopped: z.literal(true)
}).strict();
export type ThreadStopResult = z.infer<typeof ThreadStopResultSchema>;

export const TurnSubmitResultSchema = z.object({
  threadId: UuidSchema,
  accepted: z.literal(true)
}).strict();
export type TurnSubmitResult = z.infer<typeof TurnSubmitResultSchema>;

export const ThreadResumeResultSchema = z.object({
  threadId: UuidSchema,
  resumed: z.literal(true),
  providerThreadId: z.string().min(1).optional()
}).strict();
export type ThreadResumeResult = z.infer<typeof ThreadResumeResultSchema>;

export const HostListedFileSchema = z.object({
  root: PathSchema,
  relPath: RelPathSchema,
  bytes: z.number().int().nonnegative(),
  kind: z.enum(['file', 'dir'])
}).strict();
export type HostListedFile = z.infer<typeof HostListedFileSchema>;

export const HostListFilesResultSchema = z.object({
  files: z.array(HostListedFileSchema)
}).strict();
export type HostListFilesResult = z.infer<typeof HostListFilesResultSchema>;

export const HostDirEntrySchema = z.object({
  name: z.string().min(1).max(512),
  kind: z.enum(['file', 'dir']),
  path: PathSchema
}).strict();
export type HostDirEntry = z.infer<typeof HostDirEntrySchema>;

export const HostListDirResultSchema = z.object({
  entries: z.array(HostDirEntrySchema)
}).strict();
export type HostListDirResult = z.infer<typeof HostListDirResultSchema>;

export const HostReadFileResultSchema = z.object({
  content: z.string(),
  encoding: z.literal('utf8')
}).strict();
export type HostReadFileResult = z.infer<typeof HostReadFileResultSchema>;

export const HostListBranchesResultSchema = z.object({
  branches: z.array(z.string().min(1)),
  truncated: z.boolean()
}).strict();

export const WorkspaceStatusResultSchema = workspaceStatusSchema;
export const WorkspaceDiffResultSchema = workspaceDiffResponseSchema;
export const WorkspaceDiffFilesResultSchema = z.object({
  files: z.array(workspaceFileStatusSchema),
  truncated: z.boolean()
}).strict();
export const WorkspaceDiffPatchResultSchema = z.object({
  patches: z.array(z.object({
    path: z.string().min(1),
    patch: z.string(),
    truncated: z.boolean()
  }).strict())
}).strict();
export const WorkspaceCommitResultSchema = z.object({
  commitSha: z.string().min(1),
  commitSubject: z.string().min(1)
}).strict();
export const WorkspaceSquashMergeResultSchema = z.object({
  merged: z.boolean(),
  commitSha: z.string().min(1),
  commitSubject: z.string().min(1)
}).strict();
export const WorkspacePullRequestResultSchema = z.object({
  pullRequest: gitHostPullRequestSchema.nullable()
}).strict();
export const WorkspacePullRequestActionResultSchema = z.object({
  ok: z.literal(true),
  message: z.string().min(1)
}).strict();
export const ProjectCloneResultSchema = z.object({
  path: PathSchema,
  gitRemoteUrl: z.string().nullable()
}).strict();
export const ProjectCloneDefaultPathResultSchema = z.object({
  path: PathSchema
}).strict();
export const CodexVoiceTranscribeResultSchema = z.object({
  model: z.string().min(1),
  text: z.string()
}).strict();
export type CodexVoiceTranscribeResult = z.infer<typeof CodexVoiceTranscribeResultSchema>;

export const HostRpcResultSchemaByType = {
  'provider.status': ProviderStatusResultSchema,
  'environment.provision': EnvironmentProvisionResultSchema,
  'environment.provision.cancel': EnvironmentProvisionCancelResultSchema,
  'environment.destroy': EnvironmentDestroyResultSchema,
  'thread.start': ThreadStartResultSchema,
  'thread.resize': ThreadResizeResultSchema,
  'thread.input': ThreadInputResultSchema,
  'thread.stop': ThreadStopResultSchema,
  'thread.resume': ThreadResumeResultSchema,
  'turn.submit': TurnSubmitResultSchema,
  'host.list_files': HostListFilesResultSchema,
  'host.list_dir': HostListDirResultSchema,
  'host.read_file': HostReadFileResultSchema,
  'host.list_branches': HostListBranchesResultSchema,
  'workspace.status': WorkspaceStatusResultSchema,
  'workspace.diff': WorkspaceDiffResultSchema,
  'workspace.diffFiles': WorkspaceDiffFilesResultSchema,
  'workspace.diffPatch': WorkspaceDiffPatchResultSchema,
  'workspace.commit': WorkspaceCommitResultSchema,
  'workspace.squash_merge': WorkspaceSquashMergeResultSchema,
  'workspace.pull_request': WorkspacePullRequestResultSchema,
  'workspace.pull_request_ready': WorkspacePullRequestActionResultSchema,
  'workspace.pull_request_draft': WorkspacePullRequestActionResultSchema,
  'workspace.pull_request_merge': WorkspacePullRequestActionResultSchema,
  'workspace.pull_request_create': WorkspacePullRequestResultSchema,
  'project.clone': ProjectCloneResultSchema,
  'project.clone_default_path': ProjectCloneDefaultPathResultSchema,
  'codex.voice.transcribe': CodexVoiceTranscribeResultSchema
} as const;

export const HostRpcErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1)
}).strict();
export type HostRpcError = z.infer<typeof HostRpcErrorSchema>;

export const HostEnrollRequestSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  hostId: UuidSchema.optional(),
  hostName: HostNameSchema,
  instanceId: UuidSchema
}).strict();
export type HostEnrollRequest = z.infer<typeof HostEnrollRequestSchema>;

export const HostEnrollResponseSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  hostId: UuidSchema,
  hostKey: z.string().min(32).max(512)
}).strict();
export type HostEnrollResponse = z.infer<typeof HostEnrollResponseSchema>;

export const HostHelloMessageSchema = z.object({
  type: z.literal('host.hello'),
  protocolVersion: ProtocolVersionSchema,
  hostId: UuidSchema,
  instanceId: UuidSchema
}).strict();
export type HostHelloMessage = z.infer<typeof HostHelloMessageSchema>;

export const HostRpcRequestMessageSchema = z.object({
  type: z.literal('host-rpc.request'),
  protocolVersion: ProtocolVersionSchema,
  requestId: RequestIdSchema,
  command: HostRpcCommandSchema
}).strict();
export type HostRpcRequestMessage = z.infer<typeof HostRpcRequestMessageSchema>;

export const HostRpcResponseSuccessSchema = z.object({
  type: z.literal('host-rpc.response'),
  protocolVersion: ProtocolVersionSchema,
  requestId: RequestIdSchema,
  ok: z.literal(true),
  commandType: HostRpcCommandTypeSchema,
  result: z.unknown()
}).strict();

export const HostRpcResponseFailureSchema = z.object({
  type: z.literal('host-rpc.response'),
  protocolVersion: ProtocolVersionSchema,
  requestId: RequestIdSchema,
  ok: z.literal(false),
  commandType: HostRpcCommandTypeSchema.optional(),
  error: HostRpcErrorSchema
}).strict();

export const HostRpcResponseMessageSchema = z.union([
  HostRpcResponseSuccessSchema,
  HostRpcResponseFailureSchema
]);
export type HostRpcResponseMessage = z.infer<typeof HostRpcResponseMessageSchema>;

export const HostEventKindSchema = z.enum([
  'thread.started',
  'thread.event',
  'turn.completed',
  'turn.failed',
  'terminal.output',
  'environment.provision.progress',
  'project.clone.progress'
]);
export type HostEventKind = z.infer<typeof HostEventKindSchema>;

/** Host-emitted work evidence. Sequence is assigned by the server, never the host. */
export const HostEventEnvelopeSchema = z.object({
  threadId: UuidSchema.optional(),
  kind: HostEventKindSchema,
  payload: z.unknown().optional()
}).strict();
export type HostEventEnvelope = z.infer<typeof HostEventEnvelopeSchema>;

export const HostEventBatchMessageSchema = z.object({
  type: z.literal('host.event'),
  protocolVersion: ProtocolVersionSchema,
  hostId: UuidSchema,
  instanceId: UuidSchema,
  events: z.array(HostEventEnvelopeSchema).min(1).max(256)
}).strict();
export type HostEventBatchMessage = z.infer<typeof HostEventBatchMessageSchema>;

export const HostEventAckMessageSchema = z.object({
  type: z.literal('host.event-ack'),
  protocolVersion: ProtocolVersionSchema,
  accepted: z.number().int().nonnegative(),
  rejected: z.array(z.object({
    index: z.number().int().nonnegative(),
    reason: z.string().min(1)
  }))
}).strict();
export type HostEventAckMessage = z.infer<typeof HostEventAckMessageSchema>;

export const HostDaemonWsInboundSchema = z.union([
  HostHelloMessageSchema,
  HostRpcResponseSuccessSchema,
  HostRpcResponseFailureSchema,
  HostEventBatchMessageSchema
]);
export type HostDaemonWsInbound = z.infer<typeof HostDaemonWsInboundSchema>;

export const HostDaemonWsOutboundSchema = z.discriminatedUnion('type', [
  HostRpcRequestMessageSchema,
  HostEventAckMessageSchema
]);
export type HostDaemonWsOutbound = z.infer<typeof HostDaemonWsOutboundSchema>;

export function parseHostRpcResult(
  commandType: HostRpcCommandType,
  result: unknown
): unknown {
  return HostRpcResultSchemaByType[commandType].parse(result);
}

export { environmentStatusSchema, workspaceProvisionTypeSchema };
