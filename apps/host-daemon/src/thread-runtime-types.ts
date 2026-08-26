import type { HostBridgeLaunch, ProviderListModelsResult } from '@zana-ai/zcc-contracts/host-rpc';
import type { ReasoningLevel } from '@zana-ai/zcc-domain/thread-runtime';
import type { ThreadResumeInput, ThreadWorkInput } from './command-dispatch.js';

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
  dispose(): void;
}
