import { expect, it } from "vitest";
import { experimental_createDeltaAssembler as createDeltaAssembler } from "@zana-ai/zcc-plugin-sdk/provider-bridge/testing";
import { createCodexEventTranslator } from "./translator.js";

it.each([
  ["contextWindowExceeded", "context-window-exceeded", "contextWindowExceeded"],
  ["sessionBudgetExceeded", "budget-exceeded", "sessionBudgetExceeded"],
  ["usageLimitExceeded", "rate-limit", "usageLimitExceeded"],
  ["serverOverloaded", "overloaded", "serverOverloaded"],
  ["cyberPolicy", "policy", "cyberPolicy"],
  ["misalignmentPolicyViolation", "policy", "misalignmentPolicyViolation"],
  ["internalServerError", "internal", "internalServerError"],
  ["unauthorized", "unauthorized", "unauthorized"],
  ["badRequest", "bad-request", "badRequest"],
  ["threadRollbackFailed", "thread-rollback-failed", "threadRollbackFailed"],
  ["sandboxError", "sandbox", "sandboxError"],
  ["other", "unknown", "other"],
  ["rateLimitExceeded", "rate-limit", "rateLimitExceeded"],
  ["flexUnavailable", "overloaded", "flexUnavailable"],
  ["policyCapacityUnavailable", "overloaded", "policyCapacityUnavailable"],
  ["modelNotFound", "bad-request", "modelNotFound"],
  ["tooManyDenials", "policy", "tooManyDenials"],
  ["futureError", "unknown", "futureError"],
  [{ futureVariant: { detail: "new protocol payload" } }, "unknown", "futureVariant"],
  [{}, "unknown", "unknown"],
  [{ httpConnectionFailed: { httpStatusCode: 503 } }, "connection-failed", "httpConnectionFailed", 503],
  [{ responseStreamConnectionFailed: { httpStatusCode: 502 } }, "connection-failed", "responseStreamConnectionFailed", 502],
  [{ responseStreamDisconnected: { httpStatusCode: null } }, "stream-disconnected", "responseStreamDisconnected"],
  [{ responseTooManyFailedAttempts: { httpStatusCode: 429 } }, "too-many-failed-attempts", "responseTooManyFailedAttempts", 429],
  [{ activeTurnNotSteerable: { turnKind: "compact" } }, "active-turn-not-steerable", "activeTurnNotSteerable"],
] as const)("settles failed turns and classifies %j", (codexErrorInfo, category, providerCode, httpStatusCode: number | null = null) => {
  const translator = createCodexEventTranslator({ additionalWorkspaceWriteRoots: [] });
  const assembler = createDeltaAssembler({ providerId: "codex", entropyPrefix: "compat", textDeltaFlushMs: 0 });
  const translate = (method: string, params: Record<string, unknown>) => assembler.assemble({
    threadId: "compat-thread",
    deltas: translator.translateEvent({ jsonrpc: "2.0", method, params }),
  });
  const error = { message: "terminal failure", codexErrorInfo, additionalDetails: null };
  expect(translate("error", { threadId: "t1", turnId: "turn-1", error, willRetry: false })).toEqual([
    expect.objectContaining({ type: "provider/error", errorInfo: {
      category, providerCode, httpStatusCode,
    } }),
  ]);
  expect(translate("turn/completed", {
    threadId: "t1", turn: { id: "turn-1", status: "failed", error },
  })).toEqual([
    expect.objectContaining({ type: "turn/completed", status: "failed", error: { message: "terminal failure" } }),
  ]);
});

it.each([42, [], true])("does not accept malformed error information %j", (codexErrorInfo) => {
  const translator = createCodexEventTranslator({ additionalWorkspaceWriteRoots: [] });
  expect(translator.translateEvent({ jsonrpc: "2.0", method: "turn/completed", params: {
    threadId: "t1", turn: { id: "turn-1", status: "failed", error: { message: "failure", codexErrorInfo } },
  } })).toEqual([expect.objectContaining({ kind: "unhandled" })]);
});
