/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SalesforceUiProvider } from "../../ui.js";
import { STUDIO_RPC } from "../../lib/studio-contract.js";
import { SalesforceProjectTab, readProjectView, studioWindowTitle } from "./SalesforceProjectTab.js";
import { DETACHED_VIEW_REFRESH_MS, SalesforceStudioDetachedCard } from "./SalesforceStudioDetachedCard.js";
import { SalesforceToolsLink, openSalesforceTools } from "./salesforce-tools-link.js";

const control = vi.hoisted(() => ({ options: null as null | { execute(command: unknown): unknown; state(): unknown } }));

vi.mock("./useSalesforceControl.js", () => ({ useSalesforceControl: (options: NonNullable<typeof control.options> & { surface: string }) => { if (options.surface === "workbench") control.options = options; } }));

vi.mock("./AgentScriptPanel.js", async () => {
  const { useEffect } = await import("react");
  return {
    AgentforcePlaygroundPanel: ({ headerActions, onActivePath }: { headerActions?: React.ReactNode; onActivePath?: (path: string | null) => void }) => {
      useEffect(() => {
        onActivePath?.("force-app/main/default/aiAuthoringBundles/Help/Help.agent");
        return () => onActivePath?.(null);
      }, [onActivePath]);
      return <div data-testid="script">Agentforce script{headerActions}</div>;
    },
  };
});

const org = { alias: "dev", kind: "sandbox" as const, orgId: "00D000000000001", username: "dev@example.com", apiVersion: "62.0", instanceUrl: "https://example.com" };
const status = { ok: true, projectId: "p", projectName: "Project One", projectRoot: "/project", targetSource: "project", selectedAlias: "dev", defaultOrg: "dev", orgs: [org], dxProject: true };
const navigate = { toCompose: vi.fn(), openThreadPanel: vi.fn(), toProject: vi.fn() };
const call = vi.fn();
const useWindowTitle = vi.fn();
let surface: string | undefined;
let shared: unknown;

function respond(method: string) {
  if (method === "status") return status;
  if (method === "orgs") return { ok: true, orgs: [org], selectedAlias: "dev" };
  if (method === "operations.list") return { ok: true, operations: [] };
  if (method === STUDIO_RPC.viewGet) return shared;
  return { ok: true };
}

beforeEach(() => {
  localStorage.clear();
  call.mockReset();
  useWindowTitle.mockReset();
  call.mockImplementation(async (method: string) => respond(method));
  surface = "plugin-view";
  shared = { ok: true, shared: false, state: null };
  Object.assign(globalThis, {
    __ZCC_PLUGIN_HOST__: { callRpc: (_id: string, method: string, args?: Record<string, unknown>) => call(method, args) },
    __ZCC_PLUGIN_RUNTIME__: {
      useZccNavigate: () => navigate,
      useZccContext: () => ({ projectId: "p", threadId: null, ...(surface ? { surface } : {}) }),
      useWindowTitle,
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (globalThis as any).__ZCC_PLUGIN_HOST__;
  delete (globalThis as any).__ZCC_PLUGIN_RUNTIME__;
});
const mount = (element: React.ReactNode) => render(<SalesforceUiProvider client={{ call }}>{element}</SalesforceUiProvider>);
const calls = (method: string) => call.mock.calls.filter(([name]) => name === method).length;

describe("Salesforce Studio window", () => {
  it("shows only the Agentforce Studio: no activity bar, no general views", async () => {
    localStorage.setItem("salesforce:studio-window:p", "deployments");
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    expect(screen.getByTestId("salesforce-workbench").getAttribute("data-surface")).toBe("studio-window");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByTestId("script")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open beside agent" })).toBeNull();
    await screen.findByText(/Project One/);
    expect(screen.getByText("Agentforce")).toBeTruthy();
    expect(screen.getAllByRole("combobox", { name: "Salesforce org" })).toHaveLength(1);
    // The stored view is ignored and never rewritten from the Studio window.
    expect(localStorage.getItem("salesforce:studio-window:p")).toBe("deployments");
  });

  it("refuses general views from workbench control in the Studio window", async () => {
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    const exec = (command: unknown) => control.options!.execute(command);
    for (const view of ["data", "apex", "deployments", "overview"]) {
      expect(() => exec({ command: "view.open", input: { view }, user: false })).toThrow(/Agentforce only; use the Salesforce tab in the main window/);
    }
    expect(() => exec({ command: "view.open", input: { view: "bogus" }, user: false })).toThrow(/Choose overview/);
    expect(() => exec({ command: "view.open", input: { view: "agentforce" }, user: false })).not.toThrow();
    expect(() => exec({ command: "state", input: {}, user: false })).not.toThrow();
  });

  it("reads each surface's stored view and falls back per surface", () => {
    expect(readProjectView("p")).toBe("overview");
    expect(readProjectView("p", true)).toBe("agentforce");
    localStorage.setItem("salesforce:studio-window:p", "apex");
    localStorage.setItem("salesforce:project-tab:p", "bogus");
    expect(readProjectView("p", true)).toBe("apex");
    expect(readProjectView("p")).toBe("overview");
  });

  it("titles the window with the open agent and the org, and badges a risky org", async () => {
    const prod = { ...org, alias: "prod", kind: "production" as const };
    call.mockImplementation(async (method: string) => method === "status" ? { ...status, selectedAlias: "prod", orgs: [prod] } : respond(method));
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    await screen.findByText(/Project One/);
    expect(useWindowTitle).toHaveBeenLastCalledWith({ title: "Agentforce · Help", detail: "prod", badge: "Production", tone: "danger" });
  });

  it("warns when the selected org is not one the CLI lists", async () => {
    call.mockImplementation(async (method: string) => method === "status" ? { ...status, selectedAlias: "gone", orgs: [org] } : respond(method));
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    await screen.findByText(/Project One/);
    expect(useWindowTitle).toHaveBeenLastCalledWith({ title: "Agentforce · Help", detail: "gone", badge: "Unknown org", tone: "warning" });
  });

  it("names the view and org, and badges only production or unknown orgs that are selected", () => {
    expect(studioWindowTitle({ agentPath: null, alias: "" })).toEqual({ title: "Agentforce" });
    expect(studioWindowTitle({ agentPath: "a/b/Help.AGENT", alias: "dev", orgKind: "sandbox" })).toEqual({ title: "Agentforce · Help", detail: "dev" });
    expect(studioWindowTitle({ agentPath: "a/Help.agent", alias: "x", orgKind: "unknown" })).toEqual({ title: "Agentforce · Help", detail: "x", badge: "Unknown org", tone: "warning" });
    expect(studioWindowTitle({ agentPath: null, alias: "", orgKind: "production" })).toEqual({ title: "Agentforce" });
  });

  it("keeps the tab strip in the main window", () => {
    surface = undefined;
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    expect(useWindowTitle).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("tablist", { name: "Salesforce tools" }).getAttribute("aria-orientation")).toBeNull();
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("salesforce-workbench").getAttribute("data-surface")).toBeNull();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Overview", "Data", "Apex & logs", "Deployments", "Agentforce"]);
    expect(screen.queryByRole("button", { name: "Open beside agent" })).toBeNull();
  });
});

describe("Salesforce tools link", () => {
  it("sends the Studio window to the main window project and hides in the main window", () => {
    mount(<SalesforceToolsLink projectId="p" />);
    fireEvent.click(screen.getByRole("button", { name: /Salesforce/ }));
    expect(navigate.toProject).toHaveBeenCalledWith("p");
    openSalesforceTools(navigate, "q");
    expect(navigate.toProject).toHaveBeenLastCalledWith("q");
    cleanup();
    surface = undefined;
    mount(<SalesforceToolsLink projectId="p" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Salesforce Studio detached card", () => {
  beforeEach(() => { surface = undefined; });
  const card = (focusWindow = vi.fn(), bringBack = vi.fn()) => {
    mount(<SalesforceStudioDetachedCard pluginId="salesforce" projectId="p" focusWindow={focusWindow} bringBack={bringBack} />);
    return { focusWindow, bringBack };
  };

  it("keeps the general tools working, without Agentforce, and hands off to the Studio window", async () => {
    shared = {
      ok: true,
      shared: true,
      state: {
        surface: "studio", path: "force-app/main/default/aiAuthoringBundles/Help/Help.agent", dirty: true, tool: "code", share: true, at: 1,
        diagnostics: [{ line: 1, column: 1, endLine: 1, endColumn: 2, severity: "error", message: "bad" }, { line: 2, column: 1, endLine: 1, endColumn: 2, severity: "warning", message: "meh" }],
      },
    };
    const { focusWindow, bringBack } = card();
    expect(await screen.findByText("Help.agent")).toBeTruthy();
    expect(screen.getByText("Agentforce Studio is open in its own window")).toBeTruthy();
    expect(screen.getByText("Unsaved edits")).toBeTruthy();
    expect(screen.getByText("2 problems")).toBeTruthy();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Overview", "Data", "Apex & logs", "Deployments"]);
    expect(screen.queryByTestId("script")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Deployments" }));
    expect(screen.getByLabelText("Targeted Apex tests")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show window" }));
    fireEvent.click(screen.getByRole("button", { name: "Bring back here" }));
    expect(focusWindow).toHaveBeenCalledTimes(1);
    expect(bringBack).toHaveBeenCalledTimes(1);
  });

  it("ignores a stored Agentforce view and sends Build an agent to the Studio window", async () => {
    localStorage.setItem("salesforce:project-tab:p", "agentforce");
    const { focusWindow } = card();
    expect(await screen.findByText("Ready for your next change.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Build an agent/ }));
    expect(focusWindow).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("script")).toBeNull();
  });

  it("refuses the agentforce view from workbench control while detached", async () => {
    card();
    await screen.findByText("Agentforce Studio is open in its own window");
    const exec = (input: unknown) => control.options!.execute({ command: "view.open", input, user: false });
    expect(() => exec({ view: "agentforce" })).toThrow(/open in its own window/);
    act(() => { exec({ view: "data" }); });
    expect(screen.getByRole("tab", { name: "Data" }).getAttribute("aria-selected")).toBe("true");
  });

  it("shows only the notice when nothing is shared, and re-reads the shared view on a timer until unmount", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<SalesforceUiProvider client={{ call }}><SalesforceStudioDetachedCard pluginId="salesforce" projectId="p" focusWindow={vi.fn()} bringBack={vi.fn()} /></SalesforceUiProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(calls(STUDIO_RPC.viewGet)).toBe(1);
    expect(screen.queryByText("Unsaved edits")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(DETACHED_VIEW_REFRESH_MS); });
    expect(calls(STUDIO_RPC.viewGet)).toBe(2);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(DETACHED_VIEW_REFRESH_MS * 3); });
    expect(calls(STUDIO_RPC.viewGet)).toBe(2);
  });

  it("names a single problem and omits the tags for a clean agent", async () => {
    shared = { ok: true, shared: true, state: { surface: "studio", path: "Solo.agent", dirty: false, tool: null, share: true, at: 1, diagnostics: [{ line: 1, column: 1, endLine: 1, endColumn: 2, severity: "error", message: "bad" }] } };
    card();
    expect(await screen.findByText("1 problem")).toBeTruthy();
    expect(screen.queryByText("Unsaved edits")).toBeNull();
  });
});
