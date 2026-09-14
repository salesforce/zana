import { ControlError } from './errors.js';
import type { ProductHttpClient } from './http.js';
import { appendJournalIds, liveTitle } from './tags.js';
import type {
  InteractionPolicy,
  PendingInteraction,
  ThreadLaunchSpec,
  ThreadRecord,
  ThreadWaitUntil
} from './types.js';
import { listInteractions, waitForThreadEvent, waitForThreadStatus } from './wait.js';

export class ThreadHandle {
  constructor(
    readonly http: ProductHttpClient,
    readonly id: string,
    private record: ThreadRecord
  ) {}

  snapshot(): ThreadRecord {
    return this.record;
  }

  get status(): string | undefined {
    return this.record.status;
  }

  async refresh(): Promise<ThreadRecord> {
    const shown = await this.http.request<{ thread: ThreadRecord }>(
      'GET',
      `/api/v1/threads/${encodeURIComponent(this.id)}`
    );
    this.record = shown.thread;
    return this.record;
  }

  async wait(opts: {
    until?: ThreadWaitUntil;
    timeoutMs?: number;
    onInteraction?: InteractionPolicy;
  } = {}): Promise<ThreadRecord> {
    this.record = await waitForThreadStatus(this.http, this.id, {
      until: opts.until ?? 'idle',
      timeoutMs: opts.timeoutMs ?? 120_000,
      onInteraction: opts.onInteraction
    });
    return this.record;
  }

  async waitForEvent(type: string, opts?: { afterSeq?: number; waitMs?: number }): Promise<unknown> {
    return waitForThreadEvent(this.http, this.id, { type, ...opts });
  }

  async send(text: string, opts?: { mode?: string; model?: string; acpMode?: string }): Promise<ThreadRecord> {
    const sent = await this.http.request<{ thread?: ThreadRecord }>(
      'POST',
      `/api/v1/threads/${encodeURIComponent(this.id)}/send`,
      {
        body: {
          text,
          mode: opts?.mode ?? 'auto',
          model: opts?.model,
          acpMode: opts?.acpMode
        }
      }
    );
    if (sent.thread) this.record = sent.thread;
    return this.record;
  }

  async stop(): Promise<void> {
    await this.http.request('POST', `/api/v1/threads/${encodeURIComponent(this.id)}/stop`, { body: {} });
  }

  async fork(): Promise<ThreadHandle> {
    const forked = await this.http.request<{ thread?: ThreadRecord; value?: ThreadRecord }>(
      'POST',
      `/api/v1/threads/${encodeURIComponent(this.id)}/fork`,
      { body: {} }
    );
    const row = forked.thread ?? forked.value;
    if (!row?.id) throw new ControlError('HTTP_ERROR', 'thread fork did not return an id');
    return new ThreadHandle(this.http, row.id, row);
  }

  async timeline(): Promise<unknown> {
    return this.http.request('GET', `/api/v1/threads/${encodeURIComponent(this.id)}/timeline`);
  }

  async interactions(): Promise<PendingInteraction[]> {
    return listInteractions(this.http, this.id);
  }

  async resolveInteraction(interactionId: string, resolution: unknown): Promise<unknown> {
    return this.http.request(
      'POST',
      `/api/v1/threads/${encodeURIComponent(this.id)}/interactions/${encodeURIComponent(interactionId)}/resolve`,
      { body: resolution }
    );
  }

  async assertHealthy(): Promise<ThreadRecord> {
    const row = await this.refresh();
    if (row.status === 'error') {
      throw new ControlError('UNHEALTHY', `thread ${this.id} is in error state`, { details: row });
    }
    return row;
  }
}

export type LaunchContext = {
  runId: string;
  dataDir: string;
  /** Live tests tag titles and journal ids. Operator CLI sets this false. Default true. */
  tagged?: boolean;
};

function isTagged(ctx: LaunchContext): boolean {
  return ctx.tagged !== false;
}

export async function spawnThread(
  http: ProductHttpClient,
  spec: Omit<ThreadLaunchSpec, 'surface'>,
  ctx: LaunchContext
): Promise<ThreadHandle> {
  const tagged = isTagged(ctx);
  const created = await http.request<{ thread?: ThreadRecord; value?: ThreadRecord }>(
    'POST',
    '/api/v1/threads',
    {
      body: {
        projectId: spec.projectId,
        prompt: spec.prompt,
        providerId: spec.providerId ?? 'claude-code',
        model: spec.model,
        acpMode: spec.acpMode,
        permissionMode: spec.permissionMode,
        reasoningLevel: spec.reasoningLevel,
        environment: spec.environment,
        hostId: spec.hostId,
        title: tagged ? liveTitle(ctx.runId, spec.title) : spec.title,
        parentThreadId: spec.parentThreadId,
        visibility: spec.visibility ?? (tagged ? 'hidden' : 'visible'),
        origin: 'sdk'
      }
    }
  );
  const row = created.thread ?? created.value;
  if (!row?.id) throw new ControlError('HTTP_ERROR', 'thread spawn did not return an id');
  if (tagged) {
    appendJournalIds(ctx.dataDir, ctx.runId, { threadIds: [row.id], projectId: spec.projectId });
  }
  return new ThreadHandle(http, row.id, row);
}
