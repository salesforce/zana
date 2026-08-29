import type { HostBridgeLaunch, ProviderListModelsResult } from '@zana-ai/zcc-contracts/host-rpc';
import type { ReasoningLevel } from '@zana-ai/zcc-domain/thread-runtime';
import type { ReapIdleProviderSessionsArgs, ReapIdleProviderSessionsResult } from '@zana-ai/zcc-agent-runtime';
import type {
  ThreadArchiveInput,
  ThreadResumeInput,
  ThreadRewindPrepareInput,
  ThreadWorkInput
} from './command-dispatch.js';

export interface ThreadRuntimeAdapter {
  listModels(input: {
    providerId: string;
    bridgeLaunch: HostBridgeLaunch;
    cwd?: string;
  }): Promise<ProviderListModelsResult>;
  startWork(input: ThreadWorkInput): Promise<{ providerThreadId?: string } | void>;
  submitTurn(input: {
    threadId: string;
    input: string[];
    mode?: string;
    model?: string;
    reasoningLevel?: ReasoningLevel;
    clientRequestId?: string;
  }): Promise<void>;
  resumeWork(input: ThreadResumeInput): Promise<{ providerThreadId?: string } | void>;
  resizeWork(input: { threadId: string; cols: number; rows: number }): Promise<void>;
  writeWork(input: { threadId: string; data: string }): Promise<void>;
  stopWork(input: { threadId: string }): Promise<void>;
  prepareRewind(input: ThreadRewindPrepareInput): Promise<{ providerThreadId: string }>;
  discardRewind(input: { leaseId: string; environmentId: string }): Promise<void>;
  renameWork(input: { threadId: string; title: string }): Promise<void>;
  archiveWork(input: ThreadArchiveInput): Promise<void>;
  unarchiveWork(input: ThreadArchiveInput): Promise<void>;
  clearGoal(input: { threadId: string }): Promise<{ cleared: boolean }>;
  reapIdleProviderSessions(args: ReapIdleProviderSessionsArgs): Promise<ReapIdleProviderSessionsResult>;
  refreshSkillCatalog(): Promise<void>;
  listLoadedEnvironments(): string[];
  dispose(): void;
}
