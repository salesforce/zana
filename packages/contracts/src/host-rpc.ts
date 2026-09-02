import { z } from 'zod';
import {
  discoveredWorkspacePropertiesSchema,
  environmentStatusSchema,
  gitHostPullRequestMergeMethodSchema,
  gitHostPullRequestSchema,
  provisioningTranscriptEntrySchema,
  workspaceDiffResponseSchema,
  workspaceDiffTargetSchema,
  rawDiffFileStatSchema,
  workspaceProvisionTypeSchema,
  workspaceStatusSchema
} from '@zana-ai/zcc-domain';
import { gitBranchNameSchema } from '@zana-ai/zcc-domain/git-checkout';
import {
  availableModelSchema,
  clientTurnRequestIdSchema,
  dynamicToolSchema,
  FILE_LIST_LIMIT_MAX,
  FILE_LIST_QUERY_MAX_LENGTH,
  pendingInteractionResolutionSchema,
  reasoningLevelSchema
} from '@zana-ai/zcc-domain/thread-runtime';
import {
  providerCliInstallEventSchema,
  providerCliInstallRequestSchema,
  providerCliStatusResponseSchema
} from '@zana-ai/zcc-host-daemon-contract/local';
import { HOST_ARTIFACT_MAX_BYTES } from '@zana-ai/zcc-host-daemon-contract';

/**
 * Bump when any enroll payload, daemon WS message, host-rpc command, or host
 * event envelope changes shape or meaning. Mismatch fails before dispatch.
 *
 * Strategy: grow this Host-RPC version. Do not cut the enrolled path over to
 * host-daemon-contract v132 (BB's session protocol) — that would rewrite
 * host-hub, events, join, and the WS session. Missing BB commands land here.
 *
 * 17: host FS mutations (write/mkdir/move/remove/browse/exist) and host-side
 * thread rewind / archive / rename / goal.clear.
 * 18: HostBridgeLaunch is digest+byteLength (no laptop artifactPath/dataDir);
 * remotes fetch packed dist/host.js from GET /internal/plugins/:id/host/:digest.
 * 19: host FS discovery (list_paths, read_path, file_metadata, pick_folder).
 */
export const HOST_RPC_PROTOCOL_VERSION = 19;
const ProtocolVersionSchema = z.literal(HOST_RPC_PROTOCOL_VERSION);

const UuidSchema = z.string().uuid();
const RequestIdSchema = z.string().min(1).max(128);
const HostNameSchema = z.string().min(1).max(200);
const PathSchema = z.string().min(1).max(4096);
const RelPathSchema = z.string().min(1).max(1024);

export const HostRpcCommandTypeSchema = z.enum([
  'provider.status',
  'provider.list_models',
  'environment.provision',
  'environment.provision.cancel',
  'environment.destroy',
  'thread.start',
  'thread.resize',
  'thread.input',
  'thread.stop',
  'thread.plan.cancel',
  'thread.resume',
  'thread.rewind.prepare',
  'thread.rewind.discard',
  'thread.rename',
  'thread.archive',
  'thread.unarchive',
  'thread.goal.clear',
  'turn.submit',
  'terminal.start',
  'terminal.input',
  'terminal.resize',
  'terminal.stop',
  'host.list_files',
  'host.list_dir',
  'host.read_file',
  'host.write_file',
  'host.mkdir',
  'host.move_path',
  'host.remove_path',
  'host.browse_directory',
  'host.paths_exist',
  'host.list_paths',
  'host.read_path',
  'host.file_metadata',
  'host.pick_folder',
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
  'codex.voice.transcribe',
  'interactive.resolve',
  'provider.cli_status',
  'provider.cli_install',
  'host.install_global_skills',
  'host.global_skills_status',
  'peer_daemon.status',
  'peer_daemon.restart',
  'peer_daemon.install'
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
  source: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('artifact'),
      digest: z.string().regex(/^[a-f0-9]{64}$/u),
      byteLength: z.number().int().positive().max(HOST_ARTIFACT_MAX_BYTES)
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

export const ProviderListModelsCommandSchema = z.object({
  type: z.literal('provider.list_models'),
  providerId: z.string().min(1),
  bridgeLaunch: HostBridgeLaunchSchema,
  cwd: PathSchema.optional()
}).strict();
export type ProviderListModelsCommand = z.infer<typeof ProviderListModelsCommandSchema>;

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
  /**
   * Local harness, remote tools. When true the host must start the provider
   * CLI locally (no `ssh -t`) and deny native fs/shell tools in favor of
   * remote MCP / dynamic tools over the existing SSH ControlMaster path.
   */
  remoteToolProxy: z.boolean().optional(),
  reconnectTmuxId: UuidSchema.optional(),
  resume: z.boolean().optional(),
  cohort: threadLaunchCohortSchema.optional(),
  /** AgentRuntime provider bridge. Present on the Thread path; absent keeps PTY-shaped tests working. */
  bridgeLaunch: HostBridgeLaunchSchema.optional(),
  permissionMode: z.enum(['accept-edits', 'auto', 'full']).optional(),
  model: z.string().min(1).max(200).optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  providerThreadId: z.string().min(1).optional(),
  /** Correlates turn/input/accepted with the server's client/turn/requested. */
  clientRequestId: clientTurnRequestIdSchema.optional(),
  /** Plugin-registered ACP tools attached via bb-bridge for this session. */
  dynamicTools: z.array(dynamicToolSchema).max(128).optional(),
  instructions: z.string().max(100_000).optional()
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

export const ThreadPlanCancelCommandSchema = z.object({
  type: z.literal('thread.plan.cancel'),
  threadId: UuidSchema,
  expectedTurnId: z.string().min(1).max(200)
}).strict();

export const ThreadResumeFieldsSchema = z.object({
  projectId: z.string().min(1),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1),
  cwd: PathSchema.optional(),
  bridgeLaunch: HostBridgeLaunchSchema.optional(),
  permissionMode: z.enum(['accept-edits', 'auto', 'full']).optional(),
  model: z.string().min(1).max(200).optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  dynamicTools: z.array(dynamicToolSchema).max(128).optional(),
  instructions: z.string().max(100_000).optional()
}).strict();
export type ThreadResumeFields = z.infer<typeof ThreadResumeFieldsSchema>;

export const TurnSubmitCommandSchema = z.object({
  type: z.literal('turn.submit'),
  threadId: UuidSchema,
  environmentId: UuidSchema,
  input: z.array(z.string().min(1)).min(1),
  mode: z.enum(['start', 'auto', 'steer', 'queue-if-active', 'steer-if-active']).optional(),
  resume: ThreadResumeFieldsSchema.optional(),
  model: z.string().min(1).max(200).optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  clientRequestId: clientTurnRequestIdSchema.optional()
}).strict();

export const ThreadResumeCommandSchema = ThreadResumeFieldsSchema.extend({
  type: z.literal('thread.resume'),
  threadId: UuidSchema,
  environmentId: UuidSchema
}).strict();

export const ThreadRewindPrepareCommandSchema = z.object({
  type: z.literal('thread.rewind.prepare'),
  threadId: UuidSchema,
  environmentId: UuidSchema,
  leaseId: z.string().min(1).max(128),
  projectId: z.string().min(1),
  providerId: z.string().min(1),
  sourceProviderThreadId: z.string().min(1).max(200),
  retainThroughProviderCheckpoint: z.string().min(1).max(400),
  cwd: PathSchema.optional(),
  bridgeLaunch: HostBridgeLaunchSchema.optional(),
  permissionMode: z.enum(['accept-edits', 'auto', 'full']).optional(),
  model: z.string().min(1).max(200).optional(),
  reasoningLevel: reasoningLevelSchema.optional()
}).strict();

export const ThreadRewindDiscardCommandSchema = z.object({
  type: z.literal('thread.rewind.discard'),
  threadId: UuidSchema,
  environmentId: UuidSchema,
  leaseId: z.string().min(1).max(128)
}).strict();

export const ThreadRenameCommandSchema = z.object({
  type: z.literal('thread.rename'),
  threadId: UuidSchema,
  environmentId: UuidSchema,
  title: z.string().min(1).max(200)
}).strict();

export const ThreadArchiveCommandSchema = z.object({
  type: z.literal('thread.archive'),
  threadId: UuidSchema,
  environmentId: UuidSchema,
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1),
  cwd: PathSchema.optional(),
  bridgeLaunch: HostBridgeLaunchSchema.optional()
}).strict();

export const ThreadUnarchiveCommandSchema = z.object({
  type: z.literal('thread.unarchive'),
  threadId: UuidSchema,
  environmentId: UuidSchema,
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1),
  cwd: PathSchema.optional(),
  bridgeLaunch: HostBridgeLaunchSchema.optional()
}).strict();

export const ThreadGoalClearCommandSchema = z.object({
  type: z.literal('thread.goal.clear'),
  threadId: UuidSchema,
  environmentId: UuidSchema
}).strict();

export const TerminalStartCommandSchema = z.object({
  type: z.literal('terminal.start'),
  sessionId: UuidSchema,
  root: PathSchema,
  cwd: PathSchema.optional(),
  cols: z.number().int().min(20).max(300).optional(),
  rows: z.number().int().min(8).max(100).optional()
}).strict();

export const TerminalInputCommandSchema = z.object({
  type: z.literal('terminal.input'),
  sessionId: UuidSchema,
  data: z.string().max(64 * 1024)
}).strict();

export const TerminalResizeCommandSchema = z.object({
  type: z.literal('terminal.resize'),
  sessionId: UuidSchema,
  cols: z.number().int().min(20).max(300),
  rows: z.number().int().min(8).max(100)
}).strict();

export const TerminalStopCommandSchema = z.object({
  type: z.literal('terminal.stop'),
  sessionId: UuidSchema
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

export const HostWriteFileCommandSchema = z.object({
  type: z.literal('host.write_file'),
  path: PathSchema,
  rootPath: PathSchema.optional(),
  content: z.string(),
  contentEncoding: z.enum(['utf8', 'base64']),
  createParents: z.boolean(),
  expectedSha256: z.string().nullable().optional(),
  mode: z.number().int().min(0).max(0o777).optional()
}).strict();

export const HostMkdirCommandSchema = z.object({
  type: z.literal('host.mkdir'),
  path: PathSchema,
  rootPath: PathSchema.optional(),
  recursive: z.boolean()
}).strict();

export const HostMovePathCommandSchema = z.object({
  type: z.literal('host.move_path'),
  sourcePath: PathSchema,
  destinationPath: PathSchema,
  rootPath: PathSchema.optional()
}).strict();

export const HostRemovePathCommandSchema = z.object({
  type: z.literal('host.remove_path'),
  path: PathSchema,
  rootPath: PathSchema.optional(),
  recursive: z.boolean()
}).strict();

export const HostBrowseDirectoryCommandSchema = z.object({
  type: z.literal('host.browse_directory'),
  path: PathSchema.optional()
}).strict();

export const HostPathsExistCommandSchema = z.object({
  type: z.literal('host.paths_exist'),
  paths: z.array(PathSchema).min(1).max(200)
}).strict();

export const HostListPathsCommandSchema = z.object({
  type: z.literal('host.list_paths'),
  path: PathSchema,
  query: z.string().max(FILE_LIST_QUERY_MAX_LENGTH).optional(),
  limit: z.number().int().positive().max(FILE_LIST_LIMIT_MAX),
  includeFiles: z.boolean(),
  includeDirectories: z.boolean()
}).strict().refine((command) => command.includeFiles || command.includeDirectories, {
  message: 'At least one path kind must be included'
});

export const HostReadPathCommandSchema = z.object({
  type: z.literal('host.read_path'),
  path: PathSchema,
  rootPath: PathSchema.optional()
}).strict();

export const HostFileMetadataCommandSchema = z.object({
  type: z.literal('host.file_metadata'),
  path: PathSchema,
  rootPath: PathSchema.optional()
}).strict();

export const HostPickFolderCommandSchema = z.object({
  type: z.literal('host.pick_folder')
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

export const InteractiveResolveCommandSchema = z.object({
  type: z.literal('interactive.resolve'),
  threadId: UuidSchema,
  interactionId: z.string().min(1).max(128),
  providerId: z.string().min(1).max(200),
  providerThreadId: z.string().min(1).max(200),
  providerRequestId: z.string().min(1).max(200),
  resolution: pendingInteractionResolutionSchema
}).strict();
export type InteractiveResolveCommand = z.infer<typeof InteractiveResolveCommandSchema>;

export const ProviderCliStatusCommandSchema = z.object({
  type: z.literal('provider.cli_status')
}).strict();
export type ProviderCliStatusCommand = z.infer<typeof ProviderCliStatusCommandSchema>;

export const ProviderCliInstallCommandSchema = providerCliInstallRequestSchema.extend({
  type: z.literal('provider.cli_install')
}).strict();
export type ProviderCliInstallCommand = z.infer<typeof ProviderCliInstallCommandSchema>;

const GlobalSkillNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

export const HostInstallGlobalSkillsCommandSchema = z.object({
  type: z.literal('host.install_global_skills'),
  skills: z.array(z.object({
    name: GlobalSkillNameSchema,
    content: z.string().min(1).max(256 * 1024)
  }).strict()).min(1).max(16)
}).strict();
export type HostInstallGlobalSkillsCommand = z.infer<typeof HostInstallGlobalSkillsCommandSchema>;

export const HostGlobalSkillsStatusCommandSchema = z.object({
  type: z.literal('host.global_skills_status'),
  names: z.array(GlobalSkillNameSchema).min(1).max(16)
}).strict();
export type HostGlobalSkillsStatusCommand = z.infer<typeof HostGlobalSkillsStatusCommandSchema>;

const PeerDaemonRemoteSchema = z.object({
  host: z.string().min(1).max(256),
  user: z.string().min(1).max(256).optional(),
  proxyJump: z.string().min(1).max(256).optional()
}).strict();

export const PeerDaemonStatusCommandSchema = z.object({
  type: z.literal('peer_daemon.status'),
  remote: PeerDaemonRemoteSchema,
  serverHost: z.string().min(1).max(256)
}).strict();
export type PeerDaemonStatusCommand = z.infer<typeof PeerDaemonStatusCommandSchema>;

export const PeerDaemonRestartCommandSchema = z.object({
  type: z.literal('peer_daemon.restart'),
  remote: PeerDaemonRemoteSchema,
  serverHost: z.string().min(1).max(256)
}).strict();
export type PeerDaemonRestartCommand = z.infer<typeof PeerDaemonRestartCommandSchema>;

export const PeerDaemonInstallCommandSchema = z.object({
  type: z.literal('peer_daemon.install'),
  remote: PeerDaemonRemoteSchema,
  joinCode: z.string().min(1).max(200),
  hostId: UuidSchema,
  serverUrl: z.string().url().max(512),
  artifactPath: PathSchema
}).strict();
export type PeerDaemonInstallCommand = z.infer<typeof PeerDaemonInstallCommandSchema>;

export const HostRpcCommandSchema = z.union([
  ProviderStatusCommandSchema,
  ProviderListModelsCommandSchema,
  EnvironmentProvisionCommandSchema,
  EnvironmentProvisionCancelCommandSchema,
  EnvironmentDestroyCommandSchema,
  ThreadStartCommandSchema,
  ThreadResizeCommandSchema,
  ThreadInputCommandSchema,
  ThreadStopCommandSchema,
  ThreadPlanCancelCommandSchema,
  ThreadResumeCommandSchema,
  ThreadRewindPrepareCommandSchema,
  ThreadRewindDiscardCommandSchema,
  ThreadRenameCommandSchema,
  ThreadArchiveCommandSchema,
  ThreadUnarchiveCommandSchema,
  ThreadGoalClearCommandSchema,
  TurnSubmitCommandSchema,
  TerminalStartCommandSchema,
  TerminalInputCommandSchema,
  TerminalResizeCommandSchema,
  TerminalStopCommandSchema,
  HostListFilesCommandSchema,
  HostListDirCommandSchema,
  HostReadFileCommandSchema,
  HostWriteFileCommandSchema,
  HostMkdirCommandSchema,
  HostMovePathCommandSchema,
  HostRemovePathCommandSchema,
  HostBrowseDirectoryCommandSchema,
  HostPathsExistCommandSchema,
  HostListPathsCommandSchema,
  HostReadPathCommandSchema,
  HostFileMetadataCommandSchema,
  HostPickFolderCommandSchema,
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
  CodexVoiceTranscribeCommandSchema,
  InteractiveResolveCommandSchema,
  ProviderCliStatusCommandSchema,
  ProviderCliInstallCommandSchema,
  HostInstallGlobalSkillsCommandSchema,
  HostGlobalSkillsStatusCommandSchema,
  PeerDaemonStatusCommandSchema,
  PeerDaemonRestartCommandSchema,
  PeerDaemonInstallCommandSchema
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

export const ProviderListModelsResultSchema = z.object({
  models: z.array(availableModelSchema),
  selectedOnlyModels: z.array(availableModelSchema)
}).strict();
export type ProviderListModelsResult = z.infer<typeof ProviderListModelsResultSchema>;

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

export const ThreadPlanCancelResultSchema = z.object({
  threadId: UuidSchema,
  cancelled: z.boolean()
}).strict();
export type ThreadPlanCancelResult = z.infer<typeof ThreadPlanCancelResultSchema>;

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

export const ThreadRewindPrepareResultSchema = z.object({
  threadId: UuidSchema,
  prepared: z.literal(true),
  providerThreadId: z.string().min(1)
}).strict();
export type ThreadRewindPrepareResult = z.infer<typeof ThreadRewindPrepareResultSchema>;

export const ThreadRewindDiscardResultSchema = z.object({
  leaseId: z.string().min(1),
  discarded: z.literal(true)
}).strict();
export type ThreadRewindDiscardResult = z.infer<typeof ThreadRewindDiscardResultSchema>;

export const ThreadRenameResultSchema = z.object({
  threadId: UuidSchema,
  renamed: z.literal(true)
}).strict();
export type ThreadRenameResult = z.infer<typeof ThreadRenameResultSchema>;

export const ThreadArchiveResultSchema = z.object({
  threadId: UuidSchema,
  archived: z.literal(true)
}).strict();
export type ThreadArchiveResult = z.infer<typeof ThreadArchiveResultSchema>;

export const ThreadUnarchiveResultSchema = z.object({
  threadId: UuidSchema,
  unarchived: z.literal(true)
}).strict();
export type ThreadUnarchiveResult = z.infer<typeof ThreadUnarchiveResultSchema>;

export const ThreadGoalClearResultSchema = z.object({
  threadId: UuidSchema,
  cleared: z.boolean()
}).strict();
export type ThreadGoalClearResult = z.infer<typeof ThreadGoalClearResultSchema>;

export const TerminalStartResultSchema = z.object({
  sessionId: UuidSchema,
  started: z.literal(true),
  pid: z.number().int().optional()
}).strict();
export type TerminalStartResult = z.infer<typeof TerminalStartResultSchema>;

export const TerminalInputResultSchema = z.object({
  sessionId: UuidSchema,
  accepted: z.literal(true)
}).strict();
export type TerminalInputResult = z.infer<typeof TerminalInputResultSchema>;

export const TerminalResizeResultSchema = z.object({
  sessionId: UuidSchema,
  resized: z.literal(true)
}).strict();
export type TerminalResizeResult = z.infer<typeof TerminalResizeResultSchema>;

export const TerminalStopResultSchema = z.object({
  sessionId: UuidSchema,
  stopped: z.literal(true)
}).strict();
export type TerminalStopResult = z.infer<typeof TerminalStopResultSchema>;

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
  encoding: z.enum(['utf8', 'base64'])
}).strict();
export type HostReadFileResult = z.infer<typeof HostReadFileResultSchema>;

export const HostWriteFileResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('written'),
    sha256: z.string().min(1),
    sizeBytes: z.number().int().nonnegative()
  }).strict(),
  z.object({
    outcome: z.literal('conflict'),
    currentSha256: z.string().nullable()
  }).strict()
]);
export type HostWriteFileResult = z.infer<typeof HostWriteFileResultSchema>;

export const HostPathMutationResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type HostPathMutationResult = z.infer<typeof HostPathMutationResultSchema>;

export const HostBrowseDirectoryEntrySchema = z.object({
  kind: z.enum(['file', 'directory']),
  name: z.string().min(1).max(512),
  path: PathSchema
}).strict();
export type HostBrowseDirectoryEntry = z.infer<typeof HostBrowseDirectoryEntrySchema>;

export const HostBrowseDirectoryResultSchema = z.object({
  directory: PathSchema,
  parent: PathSchema.nullable(),
  entries: z.array(HostBrowseDirectoryEntrySchema)
}).strict();
export type HostBrowseDirectoryResult = z.infer<typeof HostBrowseDirectoryResultSchema>;

export const HostPathsExistResultSchema = z.object({
  existence: z.record(z.string(), z.boolean())
}).strict();
export type HostPathsExistResult = z.infer<typeof HostPathsExistResultSchema>;

export const HostPathEntryKindSchema = z.enum(['file', 'directory']);
export type HostPathEntryKind = z.infer<typeof HostPathEntryKindSchema>;

export const HostPathEntrySchema = z.object({
  kind: HostPathEntryKindSchema,
  path: z.string(),
  name: z.string(),
  score: z.number(),
  positions: z.array(z.number().int().nonnegative())
}).strict();
export type HostPathEntry = z.infer<typeof HostPathEntrySchema>;

export const HostListPathsResultSchema = z.object({
  paths: z.array(HostPathEntrySchema),
  truncated: z.boolean()
}).strict();
export type HostListPathsResult = z.infer<typeof HostListPathsResultSchema>;

export const HostReadPathResultSchema = z.object({
  path: z.string(),
  content: z.string(),
  contentEncoding: z.enum(['base64', 'utf8']),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAtMs: z.number().nonnegative().optional(),
  sha256: z.string()
}).strict();
export type HostReadPathResult = z.infer<typeof HostReadPathResultSchema>;

export const HostFileMetadataResultSchema = z.object({
  path: z.string(),
  modifiedAtMs: z.number().nonnegative(),
  sizeBytes: z.number().int().nonnegative()
}).strict();
export type HostFileMetadataResult = z.infer<typeof HostFileMetadataResultSchema>;

export const HostPickFolderResultSchema = z.object({
  path: z.string().nullable()
}).strict();
export type HostPickFolderResult = z.infer<typeof HostPickFolderResultSchema>;

export const HostListBranchesResultSchema = z.object({
  branches: z.array(z.string().min(1)),
  truncated: z.boolean()
}).strict();

export const WorkspaceStatusResultSchema = workspaceStatusSchema;
export const WorkspaceDiffResultSchema = workspaceDiffResponseSchema;
export const WorkspaceDiffFilesResultSchema = z.object({
  files: z.array(rawDiffFileStatSchema),
  shortstat: z.string(),
  mergeBaseRef: z.string().nullable(),
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

export const InteractiveResolveResultSchema = z.object({
  interactionId: z.string().min(1),
  delivered: z.literal(true)
}).strict();
export type InteractiveResolveResult = z.infer<typeof InteractiveResolveResultSchema>;

export const ProviderCliStatusResultSchema = providerCliStatusResponseSchema;
export type ProviderCliStatusResult = z.infer<typeof ProviderCliStatusResultSchema>;

export const ProviderCliInstallResultSchema = z.object({
  events: z.array(providerCliInstallEventSchema)
}).strict();
export type ProviderCliInstallResult = z.infer<typeof ProviderCliInstallResultSchema>;

export const HostInstallGlobalSkillsResultSchema = z.object({
  installations: z.array(z.object({
    name: z.string().min(1),
    path: PathSchema
  }).strict())
}).strict();
export type HostInstallGlobalSkillsResult = z.infer<typeof HostInstallGlobalSkillsResultSchema>;

export const HostGlobalSkillsStatusResultSchema = z.object({
  entries: z.array(z.object({
    name: z.string().min(1),
    path: PathSchema,
    installed: z.boolean(),
    hash: z.string().nullable()
  }).strict())
}).strict();
export type HostGlobalSkillsStatusResult = z.infer<typeof HostGlobalSkillsStatusResultSchema>;

export const PeerDaemonStatusResultSchema = z.object({
  state: z.enum(['connected', 'disconnected', 'not_installed']),
  message: z.string().min(1).optional()
}).strict();
export type PeerDaemonStatusResult = z.infer<typeof PeerDaemonStatusResultSchema>;

export const PeerDaemonRestartResultSchema = z.object({
  ok: z.literal(true),
  log: z.string()
}).strict();
export type PeerDaemonRestartResult = z.infer<typeof PeerDaemonRestartResultSchema>;

export const PeerDaemonInstallResultSchema = z.object({
  ok: z.literal(true),
  log: z.string()
}).strict();
export type PeerDaemonInstallResult = z.infer<typeof PeerDaemonInstallResultSchema>;

export type {
  ProviderCliInstallActionKind,
  ProviderCliInstallEvent,
  ProviderCliKey,
  ProviderCliStatus,
  ProviderCliStatusResponse
} from '@zana-ai/zcc-host-daemon-contract/local';

export const HostRpcResultSchemaByType = {
  'provider.status': ProviderStatusResultSchema,
  'provider.list_models': ProviderListModelsResultSchema,
  'environment.provision': EnvironmentProvisionResultSchema,
  'environment.provision.cancel': EnvironmentProvisionCancelResultSchema,
  'environment.destroy': EnvironmentDestroyResultSchema,
  'thread.start': ThreadStartResultSchema,
  'thread.resize': ThreadResizeResultSchema,
  'thread.input': ThreadInputResultSchema,
  'thread.stop': ThreadStopResultSchema,
  'thread.plan.cancel': ThreadPlanCancelResultSchema,
  'thread.resume': ThreadResumeResultSchema,
  'thread.rewind.prepare': ThreadRewindPrepareResultSchema,
  'thread.rewind.discard': ThreadRewindDiscardResultSchema,
  'thread.rename': ThreadRenameResultSchema,
  'thread.archive': ThreadArchiveResultSchema,
  'thread.unarchive': ThreadUnarchiveResultSchema,
  'thread.goal.clear': ThreadGoalClearResultSchema,
  'turn.submit': TurnSubmitResultSchema,
  'terminal.start': TerminalStartResultSchema,
  'terminal.input': TerminalInputResultSchema,
  'terminal.resize': TerminalResizeResultSchema,
  'terminal.stop': TerminalStopResultSchema,
  'host.list_files': HostListFilesResultSchema,
  'host.list_dir': HostListDirResultSchema,
  'host.read_file': HostReadFileResultSchema,
  'host.write_file': HostWriteFileResultSchema,
  'host.mkdir': HostPathMutationResultSchema,
  'host.move_path': HostPathMutationResultSchema,
  'host.remove_path': HostPathMutationResultSchema,
  'host.browse_directory': HostBrowseDirectoryResultSchema,
  'host.paths_exist': HostPathsExistResultSchema,
  'host.list_paths': HostListPathsResultSchema,
  'host.read_path': HostReadPathResultSchema,
  'host.file_metadata': HostFileMetadataResultSchema,
  'host.pick_folder': HostPickFolderResultSchema,
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
  'codex.voice.transcribe': CodexVoiceTranscribeResultSchema,
  'interactive.resolve': InteractiveResolveResultSchema,
  'provider.cli_status': ProviderCliStatusResultSchema,
  'provider.cli_install': ProviderCliInstallResultSchema,
  'host.install_global_skills': HostInstallGlobalSkillsResultSchema,
  'host.global_skills_status': HostGlobalSkillsStatusResultSchema,
  'peer_daemon.status': PeerDaemonStatusResultSchema,
  'peer_daemon.restart': PeerDaemonRestartResultSchema,
  'peer_daemon.install': PeerDaemonInstallResultSchema
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
  instanceId: UuidSchema,
  homeDir: PathSchema.optional()
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
  'terminal.exited',
  'environment.provision.progress',
  'project.clone.progress'
]);
export type HostEventKind = z.infer<typeof HostEventKindSchema>;

/** Host-emitted work evidence. Sequence is assigned by the server, never the host. */
export const HostEventEnvelopeSchema = z.object({
  threadId: UuidSchema.optional(),
  terminalId: UuidSchema.optional(),
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
