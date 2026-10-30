/** @vitest-environment happy-dom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PluginPendingInteractionProps } from "@zana-ai/zcc-plugin-sdk/app";
import { normalizeCodexMcpForm } from "./mcp-elicitation-form.js";
import type { CodexMcpElicitation } from "./mcp-elicitation.js";
import { collectTestPluginApp } from "@zana-ai/zcc-plugin-sdk/testing/app";
import app from "../app.tsx";

const RegisteredElicitation = collectTestPluginApp(app, "provider-codex")
  .pendingInteractions.find((slot) => slot.id === "mcp-elicitation")!.component;
const common = { serverName: "calendar", message: "Please provide details" };
const tool = {
  ...common,
  kind: "tool_approval",
  toolName: "Create event",
  toolDescription: "Adds a calendar event",
  params: [{ name: "title", label: "Title", value: "Review" }],
  omittedParamCount: 2,
  scopes: ["session", "always"],
} satisfies CodexMcpElicitation;
function show(
  payload: unknown,
  overrides: Partial<PluginPendingInteractionProps> = {},
) {
  const props: PluginPendingInteractionProps = {
    interaction: {
      id: "request-1",
      threadId: "thread-1",
      title: "Request",
      payload: payload as never,
      createdAt: 1,
      expiresAt: null,
    },
    submit: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    ...overrides,
  };
  return { ...render(<RegisteredElicitation {...props} />), ...props };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it.each([
  ["Allow", { action: "accept" }],
  ["Always allow", { action: "accept", persist: "always" }],
  ["Allow for this session", { action: "accept", persist: "session" }],
  ["Decline", { action: "decline" }],
])("sends the explicit tool decision %s", async (name, answer) => {
  const { submit } = show(tool);
  expect(screen.getByText("calendar")).toBeTruthy();
  expect(screen.getByText("Review")).toBeTruthy();
  expect(screen.getByText("2 more arguments not shown")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: name as string, exact: true }),
  );
  await waitFor(() => expect(submit).toHaveBeenCalledWith(answer));
});
it("shows high risk app details and only the offered computer use scope", async () => {
  const { submit } = show({
    ...common,
    kind: "computer_use",
    serverName: "cua_repl",
    app: { id: "com.apple.Terminal", name: "Terminal", iconDataUrl: null },
    scopes: ["session"],
    riskLevel: "high",
    warning: "This app can run commands.",
  });
  expect(screen.getByText("High risk")).toBeTruthy();
  expect(screen.getByText("com.apple.Terminal")).toBeTruthy();
  expect(screen.queryByText("Always allow")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Allow", exact: true }),
  ).toBeNull();
  fireEvent.click(screen.getByText("Allow for this session"));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({
      action: "accept",
      persist: "session",
    }),
  );
});
it("validates and converts form fields, preserves defaults, and clears optional values", async () => {
  const fields = normalizeCodexMcpForm({
    type: "object",
    required: ["name", "count", "enabled", "choice"],
    properties: {
      name: { type: "string", title: "Name", minLength: 2 },
      count: { type: "integer", title: "Count", minimum: 1 },
      ratio: { type: "number", title: "Ratio", default: 1.5 },
      enabled: { type: "boolean", title: "Enabled" },
      choice: { type: "string", title: "Choice", enum: ["red", "blue"] },
      tags: {
        type: "array",
        title: "Tags",
        items: { type: "string", enum: ["a", "b"] },
      },
      email: {
        type: "string",
        title: "Email",
        format: "email",
        default: "old@example.com",
      },
      date: { type: "string", title: "Date", format: "date" },
      uri: { type: "string", title: "Website", format: "uri" },
    },
  });
  const { submit } = show({ ...common, kind: "form", fields });
  expect(
    (screen.getByRole("textbox", { name: /Ratio/ }) as HTMLInputElement).value,
  ).toBe("1.5");
  fireEvent.click(screen.getByText("Submit response"));
  expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Alice" },
  });
  fireEvent.change(screen.getByLabelText("Count"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Enabled"), {
    target: { value: "false" },
  });
  fireEvent.change(screen.getByLabelText("Choice"), { target: { value: "1" } });
  fireEvent.click(screen.getByLabelText("a"));
  fireEvent.click(screen.getByLabelText("b"));
  fireEvent.click(screen.getByLabelText("a"));
  fireEvent.click(screen.getByRole("button", { name: "Clear Email" }));
  fireEvent.change(screen.getByLabelText(/Date/), {
    target: { value: "2026-10-28" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /Website/ }), {
    target: { value: "https://example.com/" },
  });
  fireEvent.click(screen.getByText("Submit response"));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({
      action: "accept",
      content: {
        name: "Alice",
        count: 2,
        ratio: 1.5,
        enabled: false,
        choice: "blue",
        tags: ["b"],
        date: "2026-10-28",
        uri: "https://example.com/",
      },
    }),
  );
});
it("allows an empty form and omits blank optional numbers", async () => {
  const fields = normalizeCodexMcpForm({
    type: "object",
    properties: { count: { type: "number", title: "Count" } },
  });
  const { submit } = show({ ...common, kind: "form", fields });
  fireEvent.change(screen.getByLabelText(/Count/), { target: { value: " " } });
  fireEvent.click(screen.getByText("Submit response"));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ action: "accept", content: {} }),
  );
});
it("requires explicit user activation to open a URL and retries response without opening twice", async () => {
  const open = vi.spyOn(globalThis, "open").mockReturnValue(null);
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined);
  show(
    {
      ...common,
      kind: "url",
      url: "https://example.com/authorize",
      elicitationId: "auth-1",
    },
    { submit },
  );
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Open example.com"));
  await screen.findByRole("alert");
  expect(open).toHaveBeenCalledExactlyOnceWith(
    "https://example.com/authorize",
    "_blank",
    "noopener,noreferrer",
  );
  fireEvent.click(screen.getByText("Retry response"));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(open).toHaveBeenCalledTimes(1);
});
it("reports a failed URL open without accepting", () => {
  vi.spyOn(globalThis, "open").mockImplementation(() => {
    throw new Error("blocked");
  });
  const { submit } = show({
    ...common,
    kind: "url",
    url: "https://example.com/",
    elicitationId: "auth",
  });
  fireEvent.click(screen.getByText("Open example.com"));
  expect(screen.getByRole("alert").textContent).toContain("Could not open");
  expect(submit).not.toHaveBeenCalled();
});
it("prevents duplicate responses and can cancel after a failed submission", async () => {
  let reject!: (reason: Error) => void;
  const submit = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const { cancel } = show(tool, { submit });
  fireEvent.click(screen.getByText("Allow"));
  fireEvent.click(screen.getByText("Decline"));
  expect(screen.getByRole("status").textContent).toContain("Sending");
  expect(submit).toHaveBeenCalledTimes(1);
  reject(new Error("offline"));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByText("Cancel request"));
  await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
});
it("does not allow unsupported or malformed requests to be accepted", async () => {
  const { submit, unmount } = show({
    ...common,
    kind: "unsupported",
    nativeMode: "unknown",
    reason: "Cannot display this mode.",
  });
  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["Decline"]);
  fireEvent.click(screen.getByText("Decline"));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ action: "decline" }),
  );
  unmount();
  const { cancel } = show({ kind: "url", url: "javascript:alert(1)" });
  expect(screen.getByRole("alert").textContent).toContain(
    "could not be displayed",
  );
  fireEvent.click(screen.getByText("Cancel request"));
  await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
});
it("accepts an empty form with the Accept button", async () => {
  const { submit } = show({ ...common, kind: "form", fields: [] });
  fireEvent.click(screen.getByText("Accept"));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ action: "accept", content: {} }),
  );
});
