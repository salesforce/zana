import {
  pendingInteractionPayloadSchema,
  pendingInteractionResolutionSchema,
} from "@zana-ai/zcc-domain/thread-runtime";
import { z } from "zod";

/**
 * Bridge → runtime requests: the two channels where the provider needs an
 * answer from zcc mid-turn. Both carry canonical zcc shapes — the bridge maps
 * its provider's native forms in both directions.
 */
export const BRIDGE_INBOUND_REQUEST_METHODS = {
  toolCall: "item/tool/call",
  interactionRequest: "interaction/request",
  nativeToolDecision: "tool/policy/decide",
} as const;

export type BridgeInboundRequestMethod =
  (typeof BRIDGE_INBOUND_REQUEST_METHODS)[keyof typeof BRIDGE_INBOUND_REQUEST_METHODS];

/**
 * A dynamic (plugin-contributed) tool call. `turnId` is the bridge-minted
 * turn id when known; null means unresolved — the runtime resolves it from
 * the active turn. An empty string is malformed.
 */
export const toolCallRequestParamsSchema = z
  .object({
    providerThreadId: z.string().min(1),
    threadId: z.string().min(1).optional(),
    turnId: z.union([z.string().min(1), z.null()]),
    callId: z.string().min(1),
    tool: z.string().min(1),
    arguments: z.unknown(),
  })
  .passthrough();

export type ToolCallRequestParams = z.infer<typeof toolCallRequestParamsSchema>;

export const toolCallResultSchema = z
  .object({
    success: z.boolean(),
    contentItems: z.array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("inputText"), text: z.string() }),
        z.object({
          type: z.literal("inputImage"),
          imageUrl: z.string().min(1),
        }),
      ]),
    ),
  })
  .passthrough();

export type ToolCallResult = z.infer<typeof toolCallResultSchema>;

/**
 * An interactive request (permission approval, user question, plan-mode
 * exit). The payload is the canonical `PendingInteractionPayload` union from
 * `@zana-ai/zcc-domain/thread-runtime`; the response is the canonical resolution. Provider-specific
 * request/response dialects never cross this boundary.
 */
export const interactionRequestParamsSchema = z
  .object({
    providerThreadId: z.string().min(1),
    threadId: z.string().min(1).optional(),
    turnId: z.union([z.string().min(1), z.null()]),
    payload: pendingInteractionPayloadSchema,
  })
  .passthrough();

export type InteractionRequestParams = z.infer<
  typeof interactionRequestParamsSchema
>;

export const interactionResolutionResultSchema =
  pendingInteractionResolutionSchema;

export const nativeToolDecisionRequestSchema = z.object({
  threadId: z.string().min(1).max(256),
  providerThreadId: z.string().min(1).max(256),
  callId: z.string().min(1).max(512),
  toolName: z.string().min(1).max(512).regex(/^[^\x00-\x1f\x7f]+$/),
  input: z.record(z.string(), z.unknown()).refine((input) => {
    try { return JSON.stringify(input).length <= 256 * 1024; } catch { return false; }
  }, 'tool input exceeds native policy limit'),
});
export const nativeToolDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('allow') }).strict(),
  z.object({ action: z.literal('deny'), reason: z.string().min(1).max(1024) }).strict(),
]);

/**
 * Observational completion of a native tool call (OBL-011). A JSON-RPC
 * notification, so the bridge never waits on it. `output` is the raw text the
 * runtime may turn into a redacted preview; it is bounded here and never logged.
 */
export const NATIVE_TOOL_SETTLED_METHOD = "tool/policy/settled" as const;
export const NATIVE_TOOL_SETTLED_OUTPUT_MAX_CHARS = 32768;
export const nativeToolSettledParamsSchema = z.object({
  threadId: z.string().min(1).max(256),
  providerThreadId: z.string().min(1).max(256),
  callId: z.string().min(1).max(512),
  toolName: z.string().min(1).max(512).regex(/^[^\x00-\x1f\x7f]+$/),
  state: z.enum(["succeeded", "failed", "cancelled"]),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  exitCode: z.number().int().optional(),
  outputBytes: z.number().int().min(0).optional(),
  output: z.string().max(NATIVE_TOOL_SETTLED_OUTPUT_MAX_CHARS).optional(),
});
export type NativeToolSettledParams = z.infer<typeof nativeToolSettledParamsSchema>;
export type NativeToolDecisionRequest = z.infer<typeof nativeToolDecisionRequestSchema>;
export type NativeToolDecision = z.infer<typeof nativeToolDecisionSchema>;
