import type { HostEventEnvelope } from '@zana-ai/zcc-contracts/host-rpc';

const DEFAULT_DEBOUNCE_MS = 100;
const IMMEDIATE_KINDS = new Set([
  'thread.started',
  'turn.completed',
  'turn.failed',
  'project.clone.progress',
  'terminal.output',
  'terminal.exited'
]);

export interface EventSink {
  emit(event: HostEventEnvelope): void;
  flush(): Promise<void>;
  dispose(): Promise<void>;
}

export function createEventSink(options: {
  isSessionOpen: () => boolean;
  postEvents: (events: HostEventEnvelope[]) => Promise<void>;
  debounceMs?: number;
}): EventSink {
  const queue: HostEventEnvelope[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushing: Promise<void> | null = null;
  let disposed = false;

  async function drain(): Promise<void> {
    if (flushing) {
      await flushing;
      return;
    }
    flushing = (async () => {
      while (queue.length > 0 && !disposed && options.isSessionOpen()) {
        const batch = queue.slice(0, 256);
        try {
          await options.postEvents(batch);
        } catch {
          return;
        }
        queue.splice(0, batch.length);
      }
    })().finally(() => {
      flushing = null;
    });
    await flushing;
  }

  function schedule(): void {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  return {
    emit(event) {
      if (disposed) return;
      queue.push(event);
      if (IMMEDIATE_KINDS.has(event.kind)) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        void drain();
        return;
      }
      schedule();
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await drain();
    },
    async dispose() {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await drain();
    }
  };
}
