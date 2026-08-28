import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { PromptInput, ThreadQueuedMessage } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCreateError } from '../../http/thread-create.js';

interface QueuedStore {
  [threadId: string]: ThreadQueuedMessage[];
}

const writeChains = new Map<string, Promise<unknown>>();

function withLock<T>(key: string, fn: () => T): Promise<T> {
  const prev = writeChains.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  writeChains.set(key, run);
  void run.finally(() => {
    if (writeChains.get(key) === run) writeChains.delete(key);
  });
  return run;
}

function storePath(dataDir: string): string {
  return join(dataDir, 'thread-queued-messages.json');
}

function loadStore(dataDir: string): QueuedStore {
  try {
    const parsed = JSON.parse(readFileSync(storePath(dataDir), 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as QueuedStore;
  } catch {
    return {};
  }
}

function saveStore(dataDir: string, store: QueuedStore): void {
  mkdirSync(dataDir, { recursive: true });
  const dest = storePath(dataDir);
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, dest);
}

function promptText(content: PromptInput[]): string {
  return content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
    .trim();
}

function toQueuedMessage(
  input: PromptInput[],
  extras?: Partial<Pick<ThreadQueuedMessage, 'model' | 'reasoningLevel' | 'permissionMode' | 'serviceTier'>>
): ThreadQueuedMessage {
  const now = Date.now();
  return {
    id: randomUUID(),
    content: input,
    model: extras?.model?.trim() || 'default',
    reasoningLevel: extras?.reasoningLevel ?? 'medium',
    permissionMode: extras?.permissionMode ?? 'accept-edits',
    serviceTier: extras?.serviceTier ?? 'default',
    groupWithNext: false,
    createdAt: now,
    updatedAt: now
  };
}

export function listQueuedMessages(dataDir: string, threadId: string): ThreadQueuedMessage[] {
  return loadStore(dataDir)[threadId] ?? [];
}

export function createQueuedMessage(
  dataDir: string,
  threadId: string,
  input: PromptInput[],
  extras?: Partial<Pick<ThreadQueuedMessage, 'model' | 'reasoningLevel' | 'permissionMode' | 'serviceTier'>>
): Promise<ThreadQueuedMessage> {
  if (input.length === 0) {
    throw new ThreadCreateError(400, 'invalid-input', 'queued message input is required');
  }
  return withLock(dataDir, () => {
    const store = loadStore(dataDir);
    const message = toQueuedMessage(input, extras);
    store[threadId] = [...(store[threadId] ?? []), message];
    saveStore(dataDir, store);
    return message;
  });
}

export function updateQueuedMessage(
  dataDir: string,
  threadId: string,
  queuedMessageId: string,
  input: PromptInput[],
  expectedUpdatedAt: number
): Promise<ThreadQueuedMessage> {
  return withLock(dataDir, () => {
    const store = loadStore(dataDir);
    const list = store[threadId] ?? [];
    const index = list.findIndex((row) => row.id === queuedMessageId);
    if (index < 0) throw new ThreadCreateError(404, 'unknown-queued-message', 'queued message not found');
    const current = list[index]!;
    if (current.updatedAt !== expectedUpdatedAt) {
      throw new ThreadCreateError(409, 'queued-message-conflict', 'queued message changed');
    }
    const next: ThreadQueuedMessage = {
      ...current,
      content: input,
      updatedAt: Date.now()
    };
    const copy = [...list];
    copy[index] = next;
    store[threadId] = copy;
    saveStore(dataDir, store);
    return next;
  });
}

export function deleteQueuedMessage(dataDir: string, threadId: string, queuedMessageId: string): Promise<void> {
  return withLock(dataDir, () => {
    const store = loadStore(dataDir);
    const list = store[threadId] ?? [];
    store[threadId] = list.filter((row) => row.id !== queuedMessageId);
    saveStore(dataDir, store);
  });
}

export function reorderQueuedMessage(
  dataDir: string,
  threadId: string,
  queuedMessageId: string,
  previousQueuedMessageId: string | null
): Promise<ThreadQueuedMessage[]> {
  return withLock(dataDir, () => {
    const store = loadStore(dataDir);
    const list = [...(store[threadId] ?? [])];
    const from = list.findIndex((row) => row.id === queuedMessageId);
    if (from < 0) throw new ThreadCreateError(404, 'unknown-queued-message', 'queued message not found');
    const [moved] = list.splice(from, 1);
    if (!moved) throw new ThreadCreateError(404, 'unknown-queued-message', 'queued message not found');
    const insertAt = previousQueuedMessageId
      ? list.findIndex((row) => row.id === previousQueuedMessageId) + 1
      : 0;
    list.splice(Math.max(0, insertAt), 0, moved);
    store[threadId] = list;
    saveStore(dataDir, store);
    return list;
  });
}

export function queuedMessageText(message: ThreadQueuedMessage): string {
  return promptText(message.content);
}
