import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HostBridgeLaunch, HostEventEnvelope, ProviderListModelsResult } from '@zana-ai/zcc-contracts/host-rpc';
import {
  createAgentRuntime,
  type AgentRuntime,
  type AgentRuntimeBridgeLaunch,
  type AgentRuntimeOptions
} from '@zana-ai/zcc-agent-runtime';
import { createFakeAgentRuntime, fakeProviderEnabled } from './fake-runtime.js';
import { loadRuntimeSkillRoots } from './injected-skill-roots.js';
import {
  encodeClientTurnRequestIdNumber,
  type PermissionMode,
  type PendingInteractionCreate,
  type PendingInteractionResolution,
  type PromptInput,
  type ReasoningLevel,
  type RuntimeThreadExecutionOptions,
  type ThreadEvent
} from '@zana-ai/zcc-domain/thread-runtime';
import { HostCommandError } from './host-command-error.js';
import type { ThreadRuntimeAdapter } from './thread-runtime-types.js';
import type { ThreadResumeInput, ThreadWorkInput } from './command-dispatch.js';
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

function toRuntimeBridgeLaunch(launch: HostBridgeLaunch): AgentRuntimeBridgeLaunch {
  return {
    pluginId: launch.pluginId,
    dataDir: launch.dataDir,
    source: launch.source,
    capabilities: {
      supportsServiceTier: launch.capabilities.supportsServiceTier,
      permissionModes: launch.capabilities.permissionModes as PermissionMode[],
      supportsThreadArchive: launch.capabilities.supportsThreadArchive,
      supportsThreadRename: launch.capabilities.supportsThreadRename,
      fork: launch.capabilities.fork as AgentRuntimeBridgeLaunch['capabilities']['fork']
    }
  };
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
  /** Global `AppConfig.remoteDefaultPath` — same fallback Explorer / ssh -t use. */
  getRemoteDefaultPath?: () => string | undefined;
  onInteractiveRequest?: (request: PendingInteractionCreate) => Promise<PendingInteractionResolution>;
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
  const threadLocation = new Map<string, { environmentId: string; cwd: string }>();
  const remoteProxyByThread = new Map<string, ThreadRemoteProxy>();
  const createRuntime = options.createRuntime
    ?? (fakeProviderEnabled() ? createFakeAgentRuntime : createAgentRuntime);
  const storageRoot = join(options.dataDir ?? '/tmp/zcc-thread-runtime', 'thread-storage');
  mkdirSync(storageRoot, { recursive: true });

  function runtimeFor(environmentId: string, cwd: string): AgentRuntime {
    const existing = runtimes.get(environmentId);
    if (existing) return existing;
    const runtime = createRuntime({
      workspacePath: cwd,
      threadStorageRootPath: storageRoot,
      skillRoots: loadRuntimeSkillRoots(options.dataDir ?? storageRoot),
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
        return {
          contentItems: [{ type: 'inputText', text: 'ok' }],
          success: true
        };
      },
      ...(options.onInteractiveRequest ? { onInteractiveRequest: options.onInteractiveRequest } : {}),
      ...(options.onProcessExit ? { onProcessExit: options.onProcessExit } : {})
    });
    runtimes.set(environmentId, runtime);
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
      const dataDir = join(storageRoot, 'model-list', input.providerId);
      mkdirSync(dataDir, { recursive: true });
      const runtime = runtimeFor(`model-list:${input.providerId}`, input.cwd ?? dataDir);
      const listed = await runtime.listModels({
        providerId: input.providerId,
        bridgeLaunch: toRuntimeBridgeLaunch({ ...input.bridgeLaunch, dataDir }),
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
        ...(input.bridgeLaunch ? { bridgeLaunch: toRuntimeBridgeLaunch(input.bridgeLaunch) } : {}),
        ...(remoteProxy ? {
          disallowedTools: REMOTE_TOOL_PROXY_DISALLOWED_TOOLS,
          instructions: REMOTE_TOOL_PROXY_INSTRUCTIONS,
          dynamicTools: REMOTE_TOOL_PROXY_DYNAMIC_TOOLS
        } : {})
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
        ...(input.bridgeLaunch ? { bridgeLaunch: toRuntimeBridgeLaunch(input.bridgeLaunch) } : {})
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
    dispose() {
      for (const runtime of runtimes.values()) {
        void runtime.shutdown();
      }
      runtimes.clear();
      threadLocation.clear();
      remoteProxyByThread.clear();
    }
  };
}
