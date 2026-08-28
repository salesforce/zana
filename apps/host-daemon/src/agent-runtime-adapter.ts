import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HostBridgeLaunch, HostEventEnvelope, ProviderListModelsResult } from '@zana-ai/zcc-contracts/host-rpc';
import {
  createAgentRuntime,
  type AgentRuntime,
  type AgentRuntimeBridgeLaunch,
  type AgentRuntimeOptions
} from '@zana-ai/zcc-agent-runtime';
import { ensurePluginProcessDataDir } from '@zana-ai/zcc-agent-process-utils';
import { createFakeAgentRuntime, fakeProviderEnabled } from './fake-runtime.js';
import { loadRuntimeSkillRoots, hashInjectedSkillCatalog } from './injected-skill-roots.js';
import { ensureCachedPluginHostArtifact, type FetchPluginHostArtifact } from './plugin-host-artifact-cache.js';
import { silentArtifactCacheLogger, type ArtifactCacheLogger } from './node-artifact-cache.js';
import {
  encodeClientTurnRequestIdNumber,
  type PermissionMode,
  type PendingInteractionCreate,
  type PendingInteractionResolution,
  type PromptInput,
  type ReasoningLevel,
  type RuntimeThreadExecutionOptions,
  type ThreadEvent,
  type ToolCallRequest,
  type ToolCallResponse,
  type DynamicTool
} from '@zana-ai/zcc-domain/thread-runtime';
import { HostCommandError } from './host-command-error.js';
import type { ThreadRuntimeAdapter } from './thread-runtime-types.js';
import type { ThreadArchiveInput, ThreadResumeInput, ThreadRewindPrepareInput, ThreadWorkInput } from './command-dispatch.js';
import { packedBridgeBundleDir } from './packed-bridge-dir.js';
import {
  REMOTE_TOOL_PROXY_DISALLOWED_TOOLS,
  REMOTE_TOOL_PROXY_DYNAMIC_TOOLS,
  REMOTE_TOOL_PROXY_INSTRUCTIONS,
  isRemoteProxyTool,
  buildThreadRemoteProxy,
  remoteProxyToolCallResponse,
  usesRemoteToolProxy,
  type ThreadRemoteProxy
} from './remote-tool-proxy.js';

export const DEFAULT_THREAD_EXECUTION_OPTIONS: RuntimeThreadExecutionOptions = {
  model: 'default',
  serviceTier: 'default',
  reasoningLevel: 'medium',
  workflowsEnabled: false,
  permissionMode: 'full',
  permissionScope: 'full',
  approvalReviewer: null,
  permissionEscalation: null
};

export function mergeSessionTooling(input: {
  remoteProxy: boolean;
  dynamicTools?: DynamicTool[];
  instructions?: string;
}): {
  disallowedTools?: readonly string[];
  instructions?: string;
  dynamicTools?: DynamicTool[];
} {
  const pluginTools = input.dynamicTools ?? [];
  const pluginInstructions = input.instructions?.trim();
  if (input.remoteProxy) {
    return {
      disallowedTools: REMOTE_TOOL_PROXY_DISALLOWED_TOOLS,
      instructions: [REMOTE_TOOL_PROXY_INSTRUCTIONS, pluginInstructions].filter(Boolean).join('\n\n'),
      dynamicTools: [...REMOTE_TOOL_PROXY_DYNAMIC_TOOLS, ...pluginTools]
    };
  }
  if (pluginTools.length === 0 && !pluginInstructions) return {};
  return {
    ...(pluginInstructions ? { instructions: pluginInstructions } : {}),
    ...(pluginTools.length > 0 ? { dynamicTools: pluginTools } : {})
  };
}

export type CreateAgentRuntimeFn = (options: AgentRuntimeOptions) => AgentRuntime;

function textInput(chunks: readonly string[]): PromptInput[] {
  return chunks
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text) => ({ type: 'text' as const, text, mentions: [] }));
}

function permissionPolicy(
  mode: RuntimeThreadExecutionOptions['permissionMode']
): Pick<
  RuntimeThreadExecutionOptions,
  'permissionMode' | 'permissionScope' | 'approvalReviewer' | 'permissionEscalation'
> {
  if (mode === 'accept-edits') {
    return {
      permissionMode: 'accept-edits',
      permissionScope: 'workspace',
      approvalReviewer: 'user',
      permissionEscalation: 'ask'
    };
  }
  if (mode === 'auto') {
    return {
      permissionMode: 'auto',
      permissionScope: 'workspace',
      approvalReviewer: 'automatic',
      permissionEscalation: 'ask'
    };
  }
  return {
    permissionMode: 'full',
    permissionScope: 'full',
    approvalReviewer: null,
    permissionEscalation: null
  };
}

export function threadExecutionOptions(input: {
  permissionMode?: RuntimeThreadExecutionOptions['permissionMode'];
  model?: string;
  reasoningLevel?: ReasoningLevel;
}): RuntimeThreadExecutionOptions {
  const mode = input.permissionMode ?? DEFAULT_THREAD_EXECUTION_OPTIONS.permissionMode;
  return {
    ...DEFAULT_THREAD_EXECUTION_OPTIONS,
    ...permissionPolicy(mode),
    ...(input.model ? { model: input.model } : {}),
    ...(input.reasoningLevel ? { reasoningLevel: input.reasoningLevel } : {})
  } as RuntimeThreadExecutionOptions;
}

function executionOptions(input: {
  permissionMode?: RuntimeThreadExecutionOptions['permissionMode'];
  model?: string;
  reasoningLevel?: ReasoningLevel;
}): RuntimeThreadExecutionOptions {
  return threadExecutionOptions(input);
}

function toRuntimeBridgeLaunch(
  launch: HostBridgeLaunch,
  dataDir: string,
  artifactPath?: string
): AgentRuntimeBridgeLaunch {
  const source =
    launch.source.kind === 'artifact'
      ? {
          kind: 'artifact' as const,
          digest: launch.source.digest,
          artifactPath: artifactPath ?? ''
        }
      : launch.source;
  return {
    pluginId: launch.pluginId,
    dataDir,
    source,
    capabilities: {
      supportsServiceTier: launch.capabilities.supportsServiceTier,
      permissionModes: launch.capabilities.permissionModes as PermissionMode[],
      supportsThreadArchive: launch.capabilities.supportsThreadArchive,
      supportsThreadRename: launch.capabilities.supportsThreadRename,
      fork: launch.capabilities.fork as AgentRuntimeBridgeLaunch['capabilities']['fork']
    }
  };
}

export async function resolveRuntimeBridgeLaunch(args: {
  launch: HostBridgeLaunch;
  daemonDataDir: string;
  fetchPluginHostArtifact?: FetchPluginHostArtifact;
  logger?: ArtifactCacheLogger;
}): Promise<AgentRuntimeBridgeLaunch> {
  const dataDir = await ensurePluginProcessDataDir({
    daemonDataDir: args.daemonDataDir,
    pluginId: args.launch.pluginId,
    kind: 'bridge-data'
  });
  if (args.launch.source.kind === 'daemon-bundled') {
    return toRuntimeBridgeLaunch(args.launch, dataDir);
  }
  if (!args.fetchPluginHostArtifact) {
    throw new Error('plugin host artifact fetch is not configured');
  }
  const artifactPath = await ensureCachedPluginHostArtifact({
    dataDir: args.daemonDataDir,
    pluginId: args.launch.pluginId,
    digest: args.launch.source.digest,
    byteLength: args.launch.source.byteLength,
    fetchArtifact: args.fetchPluginHostArtifact,
    logger: args.logger ?? silentArtifactCacheLogger
  });
  return toRuntimeBridgeLaunch(args.launch, dataDir, artifactPath);
}

function isInFlightRetryEvent(event: ThreadEvent): boolean {
  if (event.type === 'provider/error') return event.willRetry === true;
  if (event.type === 'system/error') return event.reconnectAttempt !== undefined;
  return false;
}

/** Host envelope for a runtime thread event. Retrying errors stay in-flight. */
export function mapRuntimeThreadEvent(event: ThreadEvent): HostEventEnvelope {
  if (event.type === 'turn/completed') {
    return { threadId: event.threadId, kind: 'turn.completed', payload: event };
  }
  if (event.type === 'turn/started' || isInFlightRetryEvent(event)) {
    return { threadId: event.threadId, kind: 'thread.event', payload: event };
  }
  return {
    threadId: event.threadId,
    kind: event.type.includes('error') ? 'turn.failed' : 'thread.event',
    payload: event
  };
}

/**
 * AgentRuntime-backed thread adapter. Does not import PtyManager, LaunchProvider,
 * or the PTY harness registry — those stay on the legacyAgentSession path.
 */
export function createAgentRuntimeAdapter(options: {
  emit: (event: HostEventEnvelope) => void;
  dataDir?: string;
  createRuntime?: CreateAgentRuntimeFn;
  /**
   * Packed join artifact directory (worker + Pi bridge). Defaults to the
   * sibling files next to this module when present — so a remote `join.mjs`
   * does not `import.meta.resolve` workspace packages.
   */
  bridgeBundleDir?: string;
  /** Global `AppConfig.remoteDefaultPath` — same fallback Explorer / ssh -t use. */
  getRemoteDefaultPath?: () => string | undefined;
  onInteractiveRequest?: (request: PendingInteractionCreate) => Promise<PendingInteractionResolution>;
  onPluginToolCall?: (request: ToolCallRequest) => Promise<ToolCallResponse>;
  fetchPluginHostArtifact?: FetchPluginHostArtifact;
  artifactCacheLogger?: ArtifactCacheLogger;
  onProcessExit?: (info: {
    providerId: string;
    threads: Array<{ threadId: string }>;
    code: number | null;
    expected: boolean;
    signal: string | null;
    stderr: string | null;
  }) => void;
}): ThreadRuntimeAdapter {
  const runtimes = new Map<string, AgentRuntime>();
  const runtimeMeta = new Map<string, { catalogHash: string; cwd: string }>();
  const threadLocation = new Map<string, { environmentId: string; cwd: string }>();
  const remoteProxyByThread = new Map<string, ThreadRemoteProxy>();
  const createRuntime = options.createRuntime
    ?? (fakeProviderEnabled() ? createFakeAgentRuntime : createAgentRuntime);
  const bridgeBundleDir = options.bridgeBundleDir ?? packedBridgeBundleDir();
  const storageRoot = join(options.dataDir ?? '/tmp/zcc-thread-runtime', 'thread-storage');
  mkdirSync(storageRoot, { recursive: true });
  const skillDataDir = options.dataDir ?? storageRoot;
  const daemonDataDir = options.dataDir ?? '/tmp/zcc-thread-runtime';

  function resolveLaunch(launch: HostBridgeLaunch): Promise<AgentRuntimeBridgeLaunch> {
    return resolveRuntimeBridgeLaunch({
      launch,
      daemonDataDir,
      fetchPluginHostArtifact: options.fetchPluginHostArtifact,
      logger: options.artifactCacheLogger
    });
  }

  function environmentHasThreads(environmentId: string): boolean {
    for (const location of threadLocation.values()) {
      if (location.environmentId === environmentId) return true;
    }
    return false;
  }

  function createEnvironmentRuntime(cwd: string): AgentRuntime {
    return createRuntime({
      workspacePath: cwd,
      threadStorageRootPath: storageRoot,
      skillRoots: loadRuntimeSkillRoots(skillDataDir),
      ...(bridgeBundleDir ? { bridgeBundleDir } : {}),
      onEvent: (event) => {
        options.emit(mapRuntimeThreadEvent(event));
      },
      onToolCall: async (request) => {
        const proxy = remoteProxyByThread.get(request.threadId);
        if (proxy && isRemoteProxyTool(request.tool)) {
          return remoteProxyToolCallResponse(
            proxy.remote,
            proxy.defaultPath,
            request.tool,
            request.arguments
          );
        }
        if (options.onPluginToolCall) {
          try {
            return await options.onPluginToolCall(request);
          } catch (error) {
            return {
              success: false,
              contentItems: [{
                type: 'inputText',
                text: `Tool "${request.tool}" failed: ${error instanceof Error ? error.message : String(error)}`
              }]
            };
          }
        }
        return {
          contentItems: [{ type: 'inputText', text: 'ok' }],
          success: true
        };
      },
      ...(options.onInteractiveRequest ? { onInteractiveRequest: options.onInteractiveRequest } : {}),
      ...(options.onProcessExit ? { onProcessExit: options.onProcessExit } : {})
    });
  }

  function runtimeFor(environmentId: string, cwd: string): AgentRuntime {
    const catalogHash = hashInjectedSkillCatalog(skillDataDir);
    const existing = runtimes.get(environmentId);
    const meta = runtimeMeta.get(environmentId);
    if (existing && meta) {
      if (meta.catalogHash === catalogHash) return existing;
      if (environmentHasThreads(environmentId) || existing.hasOpenBackgroundWork()) {
        return existing;
      }
      void existing.shutdown();
      runtimes.delete(environmentId);
    }
    const runtime = createEnvironmentRuntime(cwd);
    runtimes.set(environmentId, runtime);
    runtimeMeta.set(environmentId, { catalogHash, cwd });
    return runtime;
  }

  function runtimeForThread(threadId: string): AgentRuntime {
    const location = threadLocation.get(threadId);
    if (!location) {
      throw new HostCommandError('unknown_thread', 'thread is not running on this host');
    }
    return runtimeFor(location.environmentId, location.cwd);
  }

  return {
    async listModels(input: {
      providerId: string;
      bridgeLaunch: HostBridgeLaunch;
      cwd?: string;
    }): Promise<ProviderListModelsResult> {
      const workspaceCwd = input.cwd ?? join(storageRoot, 'model-list', input.providerId);
      if (!input.cwd) mkdirSync(workspaceCwd, { recursive: true });
      const runtime = runtimeFor(`model-list:${input.providerId}`, workspaceCwd);
      const listed = await runtime.listModels({
        providerId: input.providerId,
        bridgeLaunch: await resolveLaunch(input.bridgeLaunch),
        ...(input.cwd ? { cwd: input.cwd } : {})
      });
      return {
        models: listed.models,
        selectedOnlyModels: listed.selectedOnlyModels
      };
    },
    async startWork(input: ThreadWorkInput) {
      const runtime = runtimeFor(input.environmentId, input.cwd);
      threadLocation.set(input.threadId, { environmentId: input.environmentId, cwd: input.cwd });
      const remoteProxy = usesRemoteToolProxy(input);
      if (remoteProxy && input.remote) {
        remoteProxyByThread.set(
          input.threadId,
          buildThreadRemoteProxy(input.remote, options.getRemoteDefaultPath?.())
        );
      } else {
        remoteProxyByThread.delete(input.threadId);
      }
      const result = await runtime.startThread({
        environmentId: input.environmentId,
        threadId: input.threadId,
        projectId: input.projectId,
        providerId: input.providerId,
        input: textInput(input.input),
        clientRequestId: input.clientRequestId ?? encodeClientTurnRequestIdNumber({ value: Date.now() }),
        options: executionOptions({
          permissionMode: input.permissionMode,
          model: input.model,
          reasoningLevel: input.reasoningLevel
        }),
        ...(input.bridgeLaunch ? { bridgeLaunch: await resolveLaunch(input.bridgeLaunch) } : {}),
        ...mergeSessionTooling({
          remoteProxy,
          dynamicTools: input.dynamicTools,
          instructions: input.instructions
        })
      });
      return { providerThreadId: result.providerThreadId };
    },
    async submitTurn(input) {
      const runtime = runtimeForThread(input.threadId);
      await runtime.runTurn({
        threadId: input.threadId,
        input: textInput(input.input),
        clientRequestId: input.clientRequestId ?? encodeClientTurnRequestIdNumber({ value: Date.now() }),
        options: executionOptions({
          model: input.model,
          reasoningLevel: input.reasoningLevel
        })
      });
    },
    async resumeWork(input: ThreadResumeInput) {
      const runtime = runtimeFor(input.environmentId, input.cwd);
      threadLocation.set(input.threadId, { environmentId: input.environmentId, cwd: input.cwd });
      const result = await runtime.resumeThread({
        environmentId: input.environmentId,
        threadId: input.threadId,
        projectId: input.projectId,
        providerId: input.providerId,
        providerThreadId: input.providerThreadId,
        options: executionOptions({
          permissionMode: input.permissionMode,
          model: input.model,
          reasoningLevel: input.reasoningLevel
        }),
        ...(input.bridgeLaunch ? { bridgeLaunch: await resolveLaunch(input.bridgeLaunch) } : {}),
        ...mergeSessionTooling({
          remoteProxy: false,
          dynamicTools: input.dynamicTools,
          instructions: input.instructions
        })
      });
      return { providerThreadId: result.providerThreadId };
    },
    async resizeWork() {
      /* AgentRuntime has no PTY geometry. */
    },
    async writeWork() {
      /* Follow-up turns use submitTurn, not raw PTY writes. */
    },
    async stopWork(input) {
      const runtime = runtimeForThread(input.threadId);
      await runtime.stopThread({ threadId: input.threadId });
      threadLocation.delete(input.threadId);
      remoteProxyByThread.delete(input.threadId);
    },
    async prepareRewind(input: ThreadRewindPrepareInput) {
      const runtime = runtimeFor(input.environmentId, input.cwd);
      const result = await runtime.prepareThreadRewind({
        environmentId: input.environmentId,
        threadId: input.threadId,
        leaseId: input.leaseId,
        projectId: input.projectId,
        providerId: input.providerId,
        sourceProviderThreadId: input.sourceProviderThreadId,
        retainThroughProviderCheckpoint: input.retainThroughProviderCheckpoint,
        options: executionOptions({
          permissionMode: input.permissionMode,
          model: input.model,
          reasoningLevel: input.reasoningLevel
        }),
        ...(input.bridgeLaunch ? { bridgeLaunch: await resolveLaunch(input.bridgeLaunch) } : {})
      });
      return { providerThreadId: result.providerThreadId };
    },
    async discardRewind(input: { leaseId: string; environmentId: string }) {
      const runtime = runtimes.get(input.environmentId);
      if (!runtime) return;
      await runtime.discardThreadRewind({ leaseId: input.leaseId });
    },
    async renameWork(input: { threadId: string; title: string }) {
      const runtime = runtimeForThread(input.threadId);
      await runtime.renameThread({ threadId: input.threadId, title: input.title });
    },
    async archiveWork(input: ThreadArchiveInput) {
      const runtime = runtimeFor(input.environmentId, input.cwd);
      await runtime.archiveThread({
        threadId: input.threadId,
        providerId: input.providerId,
        providerThreadId: input.providerThreadId,
        ...(input.bridgeLaunch ? { bridgeLaunch: await resolveLaunch(input.bridgeLaunch) } : {})
      });
    },
    async unarchiveWork(input: ThreadArchiveInput) {
      const runtime = runtimeFor(input.environmentId, input.cwd);
      await runtime.unarchiveThread({
        threadId: input.threadId,
        providerId: input.providerId,
        providerThreadId: input.providerThreadId,
        ...(input.bridgeLaunch ? { bridgeLaunch: await resolveLaunch(input.bridgeLaunch) } : {})
      });
    },
    async clearGoal(input: { threadId: string }) {
      const runtime = runtimeForThread(input.threadId);
      return runtime.clearThreadGoal({ threadId: input.threadId });
    },
    async reapIdleProviderSessions(args) {
      const reapedSessions = [];
      for (const [environmentId, runtime] of runtimes) {
        const result = await runtime.reapIdleProviderSessions(args);
        for (const session of result.reapedSessions) {
          threadLocation.delete(session.threadId);
          remoteProxyByThread.delete(session.threadId);
          reapedSessions.push(session);
        }
      }
      return { reapedSessions };
    },
    async refreshSkillCatalog() {
      const catalogHash = hashInjectedSkillCatalog(skillDataDir);
      for (const [environmentId, runtime] of [...runtimes.entries()]) {
        const meta = runtimeMeta.get(environmentId);
        if (!meta || meta.catalogHash === catalogHash) continue;
        if (environmentHasThreads(environmentId) || runtime.hasOpenBackgroundWork()) continue;
        await runtime.shutdown();
        runtimes.delete(environmentId);
        runtimeMeta.delete(environmentId);
      }
    },
    listLoadedEnvironments() {
      return [...runtimes.keys()];
    },
    dispose() {
      for (const runtime of runtimes.values()) {
        void runtime.shutdown();
      }
      runtimes.clear();
      runtimeMeta.clear();
      threadLocation.clear();
      remoteProxyByThread.clear();
    }
  };
}
