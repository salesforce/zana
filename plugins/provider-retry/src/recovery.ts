import type {
  PluginSdkThreadEventRow,
  PluginSdkThreadSummary,
  ZccPluginApi,
} from "@zana-ai/zcc-plugin-sdk/server";

type ThreadEventPayload = Record<string, unknown>;

export interface ProviderRetryExecution {
  model: string;
  permissionMode: "accept-edits" | "auto" | "full";
}

export interface ProviderRetryCandidate {
  automatic: boolean;
  execution: ProviderRetryExecution;
  failedRequestId: string;
  resetsAtMs: number | null;
  turnId: string;
}

export type ProviderRetryInspection =
  | {
      candidate: ProviderRetryCandidate;
      hostId: string;
      reason: "eligible" | "manual-only";
      scopeKey: string;
    }
  | {
      candidate: null;
      hostId: null;
      reason:
        | "no-failed-turn"
        | "input-not-accepted"
        | "superseded"
        | "execution-unavailable"
        | "no-terminal-rate-limit-error"
        | "provider-will-retry";
      scopeKey: null;
    };

const EVENT_PAGE_SIZE = 500;
const PROVIDER_RETRY_EVENT_TYPES = [
  "client/turn/requested",
  "provider/error",
  "provider/rateLimits/updated",
  "system/thread/interrupted",
  "turn/completed",
  "turn/input/accepted",
] as const;

function asRecord(value: unknown): ThreadEventPayload | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as ThreadEventPayload)
    : null;
}

function payloadOf(row: PluginSdkThreadEventRow): ThreadEventPayload | null {
  return asRecord(row.payload);
}

function turnIdOf(row: PluginSdkThreadEventRow): string | null {
  const payload = payloadOf(row);
  if (payload === null) return null;
  const scope = asRecord(payload.scope);
  if (scope?.kind === "turn" && typeof scope.turnId === "string") {
    return scope.turnId;
  }
  return null;
}

function requestIdOf(row: PluginSdkThreadEventRow): string | null {
  const payload = payloadOf(row);
  if (payload === null) return null;
  return typeof payload.requestId === "string" ? payload.requestId : null;
}

function currentExecution(row: PluginSdkThreadEventRow): ProviderRetryExecution | null {
  const payload = payloadOf(row);
  const execution = payload === null ? null : asRecord(payload.execution);
  if (execution === null) return null;
  const permissionMode = execution.permissionMode;
  if (
    permissionMode !== "accept-edits" &&
    permissionMode !== "auto" &&
    permissionMode !== "full"
  ) {
    return null;
  }
  const model = typeof execution.model === "string" ? execution.model : "default";
  return { model, permissionMode };
}

function emptyInspection(
  reason: Extract<ProviderRetryInspection, { candidate: null }>["reason"],
): ProviderRetryInspection {
  return { candidate: null, hostId: null, reason, scopeKey: null };
}

function recoveryResetAtMs(payload: ThreadEventPayload): number | null {
  const rateLimits = asRecord(payload.rateLimits);
  if (rateLimits === null) return null;
  const windows = Array.isArray(rateLimits.windows) ? rateLimits.windows : [];
  const blocked = windows.filter((window) => {
    const record = asRecord(window);
    return record?.status === "blocked";
  });
  const relevant = blocked.length > 0 ? blocked : windows;
  const resetTimes = relevant.flatMap((window) => {
    const record = asRecord(window);
    return typeof record?.resetsAtMs === "number" ? [record.resetsAtMs] : [];
  });
  return resetTimes.length === 0 ? null : Math.max(...resetTimes);
}

function isRateLimitError(row: PluginSdkThreadEventRow): boolean {
  if (row.type !== "provider/error") return false;
  const payload = payloadOf(row);
  const errorInfo = payload === null ? null : asRecord(payload.errorInfo);
  return errorInfo?.category === "rate-limit";
}

export function classifyProviderRetry(args: {
  events: readonly PluginSdkThreadEventRow[];
  hostId: string;
  providerId: string;
}): ProviderRetryInspection {
  const requests = args.events.filter((row) => row.type === "client/turn/requested");
  const latestRequest = requests.at(-1);
  if (latestRequest === undefined) {
    return emptyInspection("input-not-accepted");
  }

  const acceptedByRequestId = new Map<string, PluginSdkThreadEventRow>();
  const completedByTurnId = new Map<string, PluginSdkThreadEventRow>();
  for (const row of args.events) {
    if (row.type === "turn/input/accepted") {
      const payload = payloadOf(row);
      const clientRequestId =
        payload !== null && typeof payload.clientRequestId === "string"
          ? payload.clientRequestId
          : null;
      if (clientRequestId !== null && !acceptedByRequestId.has(clientRequestId)) {
        acceptedByRequestId.set(clientRequestId, row);
      }
      continue;
    }
    if (row.type === "turn/completed") {
      const turnId = turnIdOf(row);
      if (turnId !== null) completedByTurnId.set(turnId, row);
    }
  }

  const requestId = requestIdOf(latestRequest);
  if (requestId === null) {
    return emptyInspection("input-not-accepted");
  }
  const accepted = acceptedByRequestId.get(requestId);
  const acceptedTurnId = accepted === undefined ? null : turnIdOf(accepted);
  const completed =
    acceptedTurnId === null ? undefined : completedByTurnId.get(acceptedTurnId);
  if (accepted === undefined || completed === undefined || acceptedTurnId === null) {
    return emptyInspection("input-not-accepted");
  }
  if (accepted.seq <= latestRequest.seq || completed.seq <= accepted.seq) {
    return emptyInspection("input-not-accepted");
  }

  const manuallyStopped = args.events.some((row) => {
    const payload = payloadOf(row);
    return (
      row.seq > latestRequest.seq &&
      row.type === "system/thread/interrupted" &&
      payload?.reason === "manual-stop"
    );
  });
  if (manuallyStopped) {
    return emptyInspection("superseded");
  }

  const completedPayload = payloadOf(completed);
  if (completedPayload?.status !== "failed") {
    return emptyInspection("no-failed-turn");
  }

  const execution = currentExecution(latestRequest);
  if (execution === null) {
    return emptyInspection("execution-unavailable");
  }

  const turnEvents = args.events.filter(
    (row) => row.seq >= latestRequest.seq && row.seq <= completed.seq,
  );
  const rateLimitErrors = turnEvents.filter(
    (row) => turnIdOf(row) === acceptedTurnId && isRateLimitError(row),
  );
  if (rateLimitErrors.length === 0) {
    return emptyInspection("no-terminal-rate-limit-error");
  }
  if (rateLimitErrors.every((row) => payloadOf(row)?.willRetry === true)) {
    return emptyInspection("provider-will-retry");
  }

  const rateLimitsEvent = [...args.events]
    .reverse()
    .find((row) => row.type === "provider/rateLimits/updated");
  const rateLimitsPayload =
    rateLimitsEvent === undefined ? null : payloadOf(rateLimitsEvent);
  const rateLimits =
    rateLimitsPayload === null ? null : asRecord(rateLimitsPayload.rateLimits);
  const automatic =
    rateLimits?.kind === "subscription-window" && rateLimits.status === "blocked";
  const resetsAtMs =
    rateLimitsPayload === null ? null : recoveryResetAtMs(rateLimitsPayload);

  return {
    candidate: {
      automatic: automatic === true && resetsAtMs !== null,
      execution,
      failedRequestId: requestId,
      resetsAtMs,
      turnId: acceptedTurnId,
    },
    hostId: args.hostId,
    reason: automatic === true && resetsAtMs !== null ? "eligible" : "manual-only",
    scopeKey: `${args.hostId}:${args.providerId}`,
  };
}

export async function inspectProviderRetry(
  zcc: ZccPluginApi,
  threadId: string,
): Promise<ProviderRetryInspection> {
  const thread = await zcc.sdk.threads.get({ threadId });
  if (thread === null || thread.environmentId === null) {
    return emptyInspection("execution-unavailable");
  }
  const events = await zcc.sdk.threads.events.list({
    threadId,
    limit: EVENT_PAGE_SIZE,
    order: "asc",
    types: [...PROVIDER_RETRY_EVENT_TYPES],
  });
  return classifyProviderRetry({
    events,
    hostId: thread.hostId,
    providerId: thread.providerId,
  });
}

export function threadSummaryHost(thread: PluginSdkThreadSummary): string {
  return thread.hostId;
}
