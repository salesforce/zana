import {
  PI_EXTENSION_UI_KIND,
  fitExtensionUiRequestToHost,
  piExtensionUiRequestSchema,
  piExtensionUiResolutionSchema,
  resolveExtensionUiResponseFields,
  type InteractionUiRequest,
  type PiExtensionUiRequest,
  type PiExtensionUiResponseFields,
  type RuntimeInteractionUiResponse,
} from "../extension-ui-contract.js";

const FIRE_AND_FORGET_METHODS = new Set([
  "notify",
  "setStatus",
  "setWidget",
  "setTitle",
  "set_editor_text",
]);

interface PendingExtensionUiRequest {
  scope: object;
  request: PiExtensionUiRequest;
  respond: (
    requestId: string | number,
    fields: PiExtensionUiResponseFields,
  ) => void;
  /** Set once Pi's own `timeout` resolved the dialog; a late answer is dropped. */
  expired: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface ExtensionUiCoordinatorOptions {
  sendInteractionRequest: (request: InteractionUiRequest) => void;
  now?: () => number;
}

export interface HandleExtensionUiRequestArgs {
  scope: object;
  request: Record<string, unknown>;
  threadId: string;
  providerThreadId: string;
  respond: (
    requestId: string | number,
    fields: PiExtensionUiResponseFields,
  ) => void;
}

export interface ExtensionUiCoordinator {
  handle(args: HandleExtensionUiRequestArgs): void;
  handleRuntimeResponse(response: RuntimeInteractionUiResponse): boolean;
  cancelPendingForScope(scope: object): void;
}

function rawMethod(request: Record<string, unknown>): unknown {
  return request.method;
}

function rawId(request: Record<string, unknown>): string | number | null {
  const id = request.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

export function createExtensionUiCoordinator(
  options: ExtensionUiCoordinatorOptions,
): ExtensionUiCoordinator {
  const pending = new Map<string, PendingExtensionUiRequest>();
  const now = options.now ?? Date.now;
  let nextRequestId = 0;

  const settle = (
    interactionId: string,
    entry: PendingExtensionUiRequest,
  ): void => {
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    pending.delete(interactionId);
  };

  return {
    handle(args) {
      if (FIRE_AND_FORGET_METHODS.has(String(rawMethod(args.request)))) {
        return;
      }
      const parsed = piExtensionUiRequestSchema.safeParse(args.request);
      if (!parsed.success) {
        const id = rawId(args.request);
        if (id !== null) {
          args.respond(id, { cancelled: true });
        }
        return;
      }
      const request: PiExtensionUiRequest = parsed.data;
      const display = fitExtensionUiRequestToHost(request, now());
      if (!display) {
        args.respond(request.id, { cancelled: true });
        return;
      }
      nextRequestId += 1;
      const interactionId = `pi-ui-${nextRequestId}`;
      const entry: PendingExtensionUiRequest = {
        scope: args.scope,
        request,
        respond: args.respond,
        expired: false,
        timer: null,
      };
      if (request.timeout !== undefined) {
        // Pi resolves the dialog to its default when `timeout` elapses and
        // discards any later response, so the answer would be meaningless.
        entry.timer = setTimeout(() => {
          entry.timer = null;
          entry.expired = true;
        }, request.timeout);
        entry.timer.unref?.();
      }
      pending.set(interactionId, entry);
      try {
        options.sendInteractionRequest({
          jsonrpc: "2.0",
          id: interactionId,
          method: "interaction/request",
          params: {
            providerThreadId: args.providerThreadId,
            threadId: args.threadId,
            turnId: null,
            payload: {
              kind: PI_EXTENSION_UI_KIND,
              title: display.title,
              data: display.data,
            },
          },
        });
      } catch {
        settle(interactionId, entry);
        args.respond(request.id, { cancelled: true });
      }
    },

    handleRuntimeResponse(response) {
      const entry = pending.get(String(response.id));
      if (!entry) {
        return false;
      }
      settle(String(response.id), entry);
      if (entry.expired) {
        return true;
      }
      const parsed = piExtensionUiResolutionSchema.safeParse(response.result);
      entry.respond(
        entry.request.id,
        parsed.success
          ? resolveExtensionUiResponseFields(entry.request, parsed.data)
          : { cancelled: true },
      );
      return true;
    },

    cancelPendingForScope(scope) {
      for (const [interactionId, entry] of pending) {
        if (entry.scope !== scope) {
          continue;
        }
        settle(interactionId, entry);
        if (!entry.expired) {
          entry.respond(entry.request.id, { cancelled: true });
        }
      }
    },
  };
}
