import { z } from "zod";

export const PI_PLUGIN_ID = "provider-pi";

export const PI_EXTENSION_UI_KIND = `${PI_PLUGIN_ID}/extension-ui`;

export const PI_EXTENSION_UI_RENDERER_ID = "extension-ui";

/**
 * Host caps on a plugin interaction (`@zana-ai/zcc-domain`
 * `PLUGIN_INTERACTION_MAX_TITLE_LENGTH` / `_PAYLOAD_BYTES`). Pi extensions do
 * not know them — sf-guardrail puts its whole approval detail in a select
 * title — so the bridge fits requests into them instead of rejecting.
 */
export const HOST_INTERACTION_MAX_TITLE_LENGTH = 160;
export const HOST_INTERACTION_MAX_PAYLOAD_BYTES = 64 * 1024;

const dialogMethodSchema = z.enum(["select", "confirm", "input", "editor"]);

const boundedText = (max: number) => z.string().max(max);

export const PI_EXTENSION_UI_MAX_OPTIONS = 64;

const PI_EXTENSION_UI_MAX_OPTION_LENGTH = 512;

const baseExtensionUiRequestSchema = z.object({
  id: z.union([z.string(), z.number()]),
  method: dialogMethodSchema,
  title: z
    .string()
    .refine(
      (value) => value.trim().length > 0,
      "Extension UI title cannot be blank",
    ),
  options: z
    .array(boundedText(PI_EXTENSION_UI_MAX_OPTION_LENGTH))
    .max(PI_EXTENSION_UI_MAX_OPTIONS)
    .optional(),
  message: z.string().optional(),
  placeholder: boundedText(1024).optional(),
  prefill: z.string().optional(),
  timeout: z.number().int().positive().optional(),
});

export const piExtensionUiRequestSchema = baseExtensionUiRequestSchema.refine(
  (request) => request.method !== "select" || (request.options?.length ?? 0) > 0,
  { message: "select requests require a non-empty options list" },
);

export type PiExtensionUiMethod = z.infer<typeof dialogMethodSchema>;

export type PiExtensionUiRequest = z.infer<typeof piExtensionUiRequestSchema>;

export const piExtensionUiPayloadDataSchema = z.object({
  requestId: z.string().min(1),
  method: dialogMethodSchema,
  options: z
    .array(boundedText(PI_EXTENSION_UI_MAX_OPTION_LENGTH))
    .max(PI_EXTENSION_UI_MAX_OPTIONS)
    .optional(),
  message: z.string().optional(),
  placeholder: boundedText(1024).optional(),
  prefill: z.string().optional(),
  /** Epoch ms after which Pi has already resolved the dialog on its own. */
  expiresAt: z.number().int().positive().optional(),
});

export type PiExtensionUiPayloadData = z.infer<
  typeof piExtensionUiPayloadDataSchema
>;

export const piExtensionUiResolutionSchema = z.object({
  kind: z.literal("request_answer"),
  value: z.unknown(),
});

export type PiExtensionUiResolution = z.infer<
  typeof piExtensionUiResolutionSchema
>;

export type PiExtensionUiResponseFields =
  | { value: string }
  | { confirmed: boolean }
  | { cancelled: true };

export interface InteractionUiRequest {
  jsonrpc: "2.0";
  id: string;
  method: "interaction/request";
  params: {
    providerThreadId: string;
    threadId: string;
    turnId: null;
    payload: {
      kind: typeof PI_EXTENSION_UI_KIND;
      title: string;
      data: PiExtensionUiPayloadData;
    };
  };
}

export type RuntimeInteractionUiResponse = {
  id: string | number;
  result?: unknown;
  error?: { message?: string };
};

export function resolveExtensionUiResponseFields(
  request: PiExtensionUiRequest,
  result: PiExtensionUiResolution,
): PiExtensionUiResponseFields {
  const { value } = result;
  if (request.method === "confirm") {
    return typeof value === "boolean"
      ? { confirmed: value }
      : { cancelled: true };
  }
  if (typeof value !== "string") {
    return { cancelled: true };
  }
  if (request.method === "select" && !request.options?.includes(value)) {
    return { cancelled: true };
  }
  return { value };
}

export interface ExtensionUiDisplay {
  title: string;
  data: PiExtensionUiPayloadData;
}

const TRUNCATION_MARKER = "\n\n… (truncated)";

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Cut to `maxLength` UTF-16 units without leaving a lone high surrogate. */
function sliceText(value: string, maxLength: number): string {
  const sliced = value.slice(0, maxLength);
  const last = sliced.charCodeAt(sliced.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
}

function fitTitle(rawTitle: string): { title: string; overflow?: string } {
  const fullTitle = rawTitle.trim();
  const newline = fullTitle.indexOf("\n");
  const firstLine = (newline === -1 ? fullTitle : fullTitle.slice(0, newline))
    .trim();
  if (firstLine.length > HOST_INTERACTION_MAX_TITLE_LENGTH) {
    return {
      title: `${sliceText(firstLine, HOST_INTERACTION_MAX_TITLE_LENGTH - 1).trimEnd()}…`,
      overflow: fullTitle,
    };
  }
  const rest = newline === -1 ? "" : fullTitle.slice(newline + 1).trim();
  return rest ? { title: firstLine, overflow: rest } : { title: firstLine };
}

/**
 * Fit a Pi dialog into the host's interaction limits. A long or multi-line
 * title keeps its first line and moves the rest into `message`; `message` is
 * truncated to the payload budget. Editable content (`prefill`) and the
 * select options are never truncated — returning a shortened draft or an
 * option Pi did not offer would be wrong — so a request whose fixed fields
 * alone overflow the budget yields null and is cancelled.
 */
export function fitExtensionUiRequestToHost(
  request: PiExtensionUiRequest,
  now: number = Date.now(),
): ExtensionUiDisplay | null {
  const { title, overflow } = fitTitle(request.title);
  const message = [overflow, request.message?.trim() ? request.message : null]
    .filter((part): part is string => typeof part === "string")
    .join("\n\n");
  const base: PiExtensionUiPayloadData = {
    requestId: String(request.id),
    method: request.method,
    ...(request.options ? { options: request.options } : {}),
    ...(request.placeholder !== undefined
      ? { placeholder: request.placeholder }
      : {}),
    ...(request.prefill !== undefined ? { prefill: request.prefill } : {}),
    ...(request.timeout !== undefined
      ? { expiresAt: now + request.timeout }
      : {}),
  };
  if (!message) {
    return jsonByteLength(base) <= HOST_INTERACTION_MAX_PAYLOAD_BYTES
      ? { title, data: base }
      : null;
  }
  const withMessage = (text: string): PiExtensionUiPayloadData => ({
    ...base,
    message: text,
  });
  if (jsonByteLength(withMessage(message)) <= HOST_INTERACTION_MAX_PAYLOAD_BYTES) {
    return { title, data: withMessage(message) };
  }
  if (
    jsonByteLength(withMessage(TRUNCATION_MARKER)) >
    HOST_INTERACTION_MAX_PAYLOAD_BYTES
  ) {
    return null;
  }
  let fits = 0;
  let overflows = message.length;
  while (overflows - fits > 1) {
    const middle = Math.floor((fits + overflows) / 2);
    const candidate = `${sliceText(message, middle)}${TRUNCATION_MARKER}`;
    if (jsonByteLength(withMessage(candidate)) <= HOST_INTERACTION_MAX_PAYLOAD_BYTES) {
      fits = middle;
    } else {
      overflows = middle;
    }
  }
  return {
    title,
    data: withMessage(`${sliceText(message, fits)}${TRUNCATION_MARKER}`),
  };
}
