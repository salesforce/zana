import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOST_INTERACTION_MAX_PAYLOAD_BYTES,
  HOST_INTERACTION_MAX_TITLE_LENGTH,
  fitExtensionUiRequestToHost,
  piExtensionUiRequestSchema,
  type InteractionUiRequest,
  type PiExtensionUiRequest,
} from "../extension-ui-contract.js";
import { createExtensionUiCoordinator } from "./extension-ui.js";

afterEach(() => {
  vi.useRealTimers();
});

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function request(fields: Partial<PiExtensionUiRequest>): PiExtensionUiRequest {
  return piExtensionUiRequestSchema.parse({
    id: "req-1",
    method: "confirm",
    title: "Allow?",
    ...fields,
  });
}

// The shape sf-guardrail's confirmDecision() sends: the whole approval
// detail lives in the select title.
const GUARDRAIL_TITLE = [
  "sf-guardrail: destructive org operation",
  "",
  "Reason: `sf project deploy start` targets a production org",
  "Risk gate: org-aware / production",
  "Subject: sf project deploy start --target-org prod --source-dir force-app",
  "Org: prod (00D000000000001) · Production",
  "Guidance: deploy to a sandbox first or allow once to continue.",
  "",
  "Approval timeout: 120s.",
].join("\n");

describe("fitExtensionUiRequestToHost", () => {
  it("keeps a short title and message as-is", () => {
    const display = fitExtensionUiRequestToHost(
      request({ title: "Allow?", message: "It writes files." }),
    );
    expect(display).toEqual({
      title: "Allow?",
      data: { requestId: "req-1", method: "confirm", message: "It writes files." },
    });
  });

  it("moves the lines after a multi-line title into the message", () => {
    const display = fitExtensionUiRequestToHost(
      request({
        method: "select",
        title: GUARDRAIL_TITLE,
        options: ["Allow once", "Allow for this session", "Block"],
      }),
    );
    expect(display?.title).toBe("sf-guardrail: destructive org operation");
    expect(display?.data.message).toBe(
      GUARDRAIL_TITLE.slice(GUARDRAIL_TITLE.indexOf("\n") + 1).trim(),
    );
    expect(display?.data.options).toEqual([
      "Allow once",
      "Allow for this session",
      "Block",
    ]);
  });

  it("truncates an over-long first line and repeats the full title in the message", () => {
    const longTitle = "x".repeat(400);
    const display = fitExtensionUiRequestToHost(
      request({ title: longTitle, message: "details" }),
    );
    expect(display?.title.length).toBe(HOST_INTERACTION_MAX_TITLE_LENGTH);
    expect(display?.title.endsWith("…")).toBe(true);
    expect(display?.data.message).toBe(`${longTitle}\n\ndetails`);
  });

  it("does not split a surrogate pair when truncating the title", () => {
    const display = fitExtensionUiRequestToHost(
      request({ title: `${"a".repeat(158)}😀😀` }),
    );
    expect(display?.title).toBe(`${"a".repeat(158)}…`);
  });

  it("truncates a message that would overflow the host payload cap", () => {
    const display = fitExtensionUiRequestToHost(
      request({ message: "é".repeat(HOST_INTERACTION_MAX_PAYLOAD_BYTES) }),
    );
    expect(display).not.toBeNull();
    expect(jsonBytes(display?.data)).toBeLessThanOrEqual(
      HOST_INTERACTION_MAX_PAYLOAD_BYTES,
    );
    expect(display?.data.message?.endsWith("… (truncated)")).toBe(true);
  });

  it("refuses to truncate an editor prefill that cannot fit", () => {
    expect(
      fitExtensionUiRequestToHost(
        request({
          method: "editor",
          prefill: "p".repeat(HOST_INTERACTION_MAX_PAYLOAD_BYTES),
        }),
      ),
    ).toBeNull();
    expect(
      fitExtensionUiRequestToHost(
        request({
          method: "editor",
          message: "m",
          prefill: "p".repeat(HOST_INTERACTION_MAX_PAYLOAD_BYTES),
        }),
      ),
    ).toBeNull();
  });

  it("stamps expiresAt from the request timeout", () => {
    const display = fitExtensionUiRequestToHost(
      request({ timeout: 120_000 }),
      1_000,
    );
    expect(display?.data.expiresAt).toBe(121_000);
  });
});

describe("createExtensionUiCoordinator", () => {
  function setup() {
    const sent: InteractionUiRequest[] = [];
    const coordinator = createExtensionUiCoordinator({
      sendInteractionRequest: (interaction) => sent.push(interaction),
    });
    const respond = vi.fn();
    const scope = {};
    const handle = (raw: Record<string, unknown>) =>
      coordinator.handle({
        scope,
        request: raw,
        threadId: "thr_1",
        providerThreadId: "thr_1",
        respond,
      });
    return { coordinator, sent, respond, scope, handle };
  }

  it("surfaces a guardrail-shaped select instead of cancelling it", () => {
    const { coordinator, sent, respond, handle } = setup();
    handle({
      type: "extension_ui_request",
      id: "ui-1",
      method: "select",
      title: GUARDRAIL_TITLE,
      options: ["Allow once", "Allow for this session", "Block"],
      timeout: 120_000,
    });
    expect(respond).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    const interaction = sent[0]!;
    expect(interaction.params.payload.title.length).toBeLessThanOrEqual(
      HOST_INTERACTION_MAX_TITLE_LENGTH,
    );
    coordinator.handleRuntimeResponse({
      id: interaction.id,
      result: { kind: "request_answer", value: "Allow once" },
    });
    expect(respond).toHaveBeenCalledWith("ui-1", { value: "Allow once" });
  });

  it("cancels a request whose fixed fields cannot fit the host cap", () => {
    const { sent, respond, handle } = setup();
    handle({
      id: "ui-2",
      method: "editor",
      title: "Edit",
      prefill: "p".repeat(HOST_INTERACTION_MAX_PAYLOAD_BYTES),
    });
    expect(sent).toHaveLength(0);
    expect(respond).toHaveBeenCalledWith("ui-2", { cancelled: true });
  });

  it("drops an answer that arrives after Pi's timeout resolved the dialog", () => {
    vi.useFakeTimers();
    const { coordinator, sent, respond, scope, handle } = setup();
    handle({
      id: "ui-3",
      method: "confirm",
      title: "Allow?",
      timeout: 1_000,
    });
    vi.advanceTimersByTime(1_000);
    expect(
      coordinator.handleRuntimeResponse({
        id: sent[0]!.id,
        result: { kind: "request_answer", value: true },
      }),
    ).toBe(true);
    expect(respond).not.toHaveBeenCalled();
    coordinator.cancelPendingForScope(scope);
    expect(respond).not.toHaveBeenCalled();
  });

  it("does not answer an expired request when its scope closes", () => {
    vi.useFakeTimers();
    const { coordinator, respond, scope, handle } = setup();
    handle({ id: "ui-4", method: "confirm", title: "A?", timeout: 10 });
    handle({ id: "ui-5", method: "confirm", title: "B?" });
    vi.advanceTimersByTime(10);
    coordinator.cancelPendingForScope(scope);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith("ui-5", { cancelled: true });
  });

  it("answers in time before the timeout and clears the timer", () => {
    vi.useFakeTimers();
    const { coordinator, sent, respond, handle } = setup();
    handle({ id: "ui-6", method: "confirm", title: "A?", timeout: 1_000 });
    coordinator.handleRuntimeResponse({
      id: sent[0]!.id,
      result: { kind: "request_answer", value: false },
    });
    expect(respond).toHaveBeenCalledWith("ui-6", { confirmed: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels when the runtime refuses the interaction request", () => {
    const respond = vi.fn();
    const coordinator = createExtensionUiCoordinator({
      sendInteractionRequest: () => {
        throw new Error("closed");
      },
    });
    coordinator.handle({
      scope: {},
      request: { id: "ui-7", method: "confirm", title: "A?", timeout: 1_000 },
      threadId: "thr_1",
      providerThreadId: "thr_1",
      respond,
    });
    expect(respond).toHaveBeenCalledWith("ui-7", { cancelled: true });
  });
});
