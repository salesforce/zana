import path from "node:path";
import type {
  ParcelAsyncSubscription,
  ParcelWatcherBackend,
  ParcelWatcherEventBatch,
} from "../parcel-watcher-backend.js";
import { isRescanRequiredMessage } from "../watch-recovery.js";
import { toWatchErrorMessage } from "../watch-error.js";
import type {
  ChildToParentMessage,
  ParentToChildMessage,
  SerializedParcelEvent,
} from "./messages.js";

const MAX_EVENTS_PER_MESSAGE = 10_000;

function serializeEvents(
  events: ParcelWatcherEventBatch,
): SerializedParcelEvent[] {
  return events.map((event) => ({ path: event.path, type: event.type }));
}

interface ParcelChildHandler {
  handleMessage(message: ParentToChildMessage): void;
  dispose(): Promise<void>;
}

export function createParcelChildHandler(args: {
  parcel: ParcelWatcherBackend;
  send: (message: ChildToParentMessage) => void;
  listEntries: (dir: string) => Promise<string[]>;
}): ParcelChildHandler {
  const subscriptions = new Map<string, ParcelAsyncSubscription>();
  const cancelledBeforeReady = new Set<string>();

  async function emitRescan(id: string, dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await args.listEntries(dir);
    } catch {
      return;
    }
    if (entries.length === 0) {
      return;
    }
    if (entries.length > MAX_EVENTS_PER_MESSAGE) {
      args.send({ kind: "events-dropped", id, count: entries.length });
      return;
    }
    args.send({
      kind: "events",
      id,
      events: entries.map((entry) => ({
        path: path.join(dir, entry),
        type: "update",
      })),
    });
  }

  function handleSubscribe(
    message: Extract<ParentToChildMessage, { kind: "subscribe" }>,
  ): void {
    args.parcel
      .subscribe(
        message.dir,
        (error, events) => {
          if (error) {
            const errorMessage = toWatchErrorMessage(error);
            args.send({
              kind: "watch-error",
              id: message.id,
              message: errorMessage,
              recovery: isRescanRequiredMessage(errorMessage)
                ? "rescan-subscription"
                : "recycle-child",
            });
            return;
          }
          if (events.length > MAX_EVENTS_PER_MESSAGE) {
            args.send({ kind: "events-dropped", id: message.id, count: events.length });
            return;
          }
          args.send({
            kind: "events",
            id: message.id,
            events: serializeEvents(events),
          });
        },
        message.opts,
      )
      .then(async (subscription) => {
        if (cancelledBeforeReady.delete(message.id)) {
          void subscription.unsubscribe().catch(() => {});
          return;
        }
        subscriptions.set(message.id, subscription);
        args.send({ kind: "subscribed", id: message.id });
        if (message.rescan) {
          await emitRescan(message.id, message.dir);
        }
      })
      .catch((error: unknown) => {
        cancelledBeforeReady.delete(message.id);
        args.send({
          kind: "subscribe-failed",
          id: message.id,
          message: toWatchErrorMessage(error),
        });
      });
  }

  async function handleUnsubscribe(id: string): Promise<void> {
    const subscription = subscriptions.get(id);
    if (subscription) {
      subscriptions.delete(id);
      try {
        await subscription.unsubscribe();
      } catch {}
    } else {
      cancelledBeforeReady.add(id);
    }
    args.send({ kind: "unsubscribed", id });
  }

  return {
    handleMessage(message) {
      switch (message.kind) {
        case "subscribe":
          handleSubscribe(message);
          break;
        case "unsubscribe":
          void handleUnsubscribe(message.id);
          break;
        case "ping":
          args.send({ kind: "pong", nonce: message.nonce });
          break;
      }
    },
    async dispose() {
      const pending = [...subscriptions.values()];
      subscriptions.clear();
      cancelledBeforeReady.clear();
      await Promise.all(
        pending.map((subscription) =>
          subscription.unsubscribe().catch(() => {}),
        ),
      );
    },
  };
}

/** Native unsubscribe can hang after daemon disconnect; always exit by the deadline. */
export function disposeThenExit(args: {
  deadlineMs: number;
  dispose: () => Promise<void>;
  exit: () => void;
}): void {
  let exited = false;
  const finish = () => {
    if (exited) return;
    exited = true;
    clearTimeout(timer);
    args.exit();
  };
  const timer = setTimeout(finish, args.deadlineMs);
  void Promise.resolve().then(args.dispose).then(finish, finish);
}
