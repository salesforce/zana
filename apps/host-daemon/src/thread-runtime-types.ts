import type { ThreadResumeInput, ThreadWorkInput } from './command-dispatch.js';

export interface ThreadRuntimeAdapter {
  startWork(input: ThreadWorkInput): Promise<{ providerThreadId?: string } | void>;
  submitTurn(input: { threadId: string; input: string[]; mode?: string }): Promise<void>;
  resumeWork(input: ThreadResumeInput): Promise<{ providerThreadId?: string } | void>;
  resizeWork(input: { threadId: string; cols: number; rows: number }): Promise<void>;
  writeWork(input: { threadId: string; data: string }): Promise<void>;
  stopWork(input: { threadId: string }): Promise<void>;
  dispose(): void;
}
