/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SalesforceUiProvider } from "../../ui.js";
import { STUDIO_RPC } from "../../lib/studio-contract.js";
import { SalesforceProjectTab, readProjectView, studioWindowTitle } from "./SalesforceProjectTab.js";
import { DETACHED_VIEW_REFRESH_MS, SalesforceStudioDetachedCard } from "./SalesforceStudioDetachedCard.js";
import { announceContextChanged } from "./context-sync.js";

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
const navigate = { toCompose: vi.fn(), openThreadPanel: vi.fn() };
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
  it("opens on Agentforce with an activity bar and keeps its own last view", async () => {
    localStorage.setItem("salesforce:project-tab:p", "deployments");
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    expect(screen.getByTestId("salesforce-workbench").getAttribute("data-surface")).toBe("studio-window");
    const bar = screen.getByRole("tablist", { name: "Salesforce tools" });
    expect(bar.getAttribute("aria-orientation")).toBe("vertical");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Agents", "Data", "Apex", "Deploy", "Home"]);
    expect(screen.getByRole("tab", { name: "Agents" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("script")).toBeTruthy();
    // No thread sits beside the window, so the side-panel shortcut is absent.
    expect(screen.queryByRole("button", { name: "Open beside agent" })).toBeNull();
    await screen.findByText(/Project One/);
    expect(screen.getAllByRole("combobox", { name: "Salesforce org" })).toHaveLength(1);

    fireEvent.keyDown(screen.getByRole("tab", { name: "Agents" }), { key: "ArrowDown" });
    expect(screen.getByRole("tab", { name: "Data" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Data" }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Data" }), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "Agents" }), { key: "ArrowUp" });
    expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");
    expect(localStorage.getItem("salesforce:studio-window:p")).toBe("overview");
    expect(localStorage.getItem("salesforce:project-tab:p")).toBe("deployments");
    // Horizontal arrow keys do nothing in a vertical bar.
    fireEvent.keyDown(screen.getByRole("tab", { name: "Home" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");
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
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    expect(useWindowTitle).toHaveBeenLastCalledWith({ title: "Salesforce · Data", detail: "prod", badge: "Production", tone: "danger" });
    fireEvent.click(screen.getByRole("tab", { name: "Agents" }));
    expect(useWindowTitle).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Agentforce · Help" }));
  });

  it("warns when the selected org is not one the CLI lists", async () => {
    call.mockImplementation(async (method: string) => method === "status" ? { ...status, selectedAlias: "gone", orgs: [org] } : respond(method));
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    await screen.findByText(/Project One/);
    expect(useWindowTitle).toHaveBeenLastCalledWith({ title: "Agentforce · Help", detail: "gone", badge: "Unknown org", tone: "warning" });
  });

  it("names the view and org, and badges only production or unknown orgs that are selected", () => {
    expect(studioWindowTitle({ view: "agentforce", agentPath: null, alias: "" })).toEqual({ title: "Agentforce" });
    expect(studioWindowTitle({ view: "agentforce", agentPath: "a/b/Help.AGENT", alias: "dev", orgKind: "sandbox" })).toEqual({ title: "Agentforce · Help", detail: "dev" });
    expect(studioWindowTitle({ view: "apex", agentPath: "a/Help.agent", alias: "x", orgKind: "unknown" })).toEqual({ title: "Salesforce · Apex", detail: "x", badge: "Unknown org", tone: "warning" });
    expect(studioWindowTitle({ view: "overview", agentPath: null, alias: "", orgKind: "production" })).toEqual({ title: "Salesforce · Home" });
  });

  it("keeps the tab strip in the main window", () => {
    surface = undefined;
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    expect(useWindowTitle).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("tablist", { name: "Salesforce tools" }).getAttribute("aria-orientation")).toBeNull();
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("salesforce-workbench").getAttribute("data-surface")).toBeNull();
  });
});

describe("Salesforce Studio detached card", () => {
  const card = (focusWindow = vi.fn(), bringBack = vi.fn()) => {
    mount(<SalesforceStudioDetachedCard pluginId="salesforce" projectId="p" focusWindow={focusWindow} bringBack={bringBack} />);
    return { focusWindow, bringBack };
  };

  it("shows the org and what the Studio window shares, and hands off to it", async () => {
    shared = {
      ok: true,
      shared: true,
      state: {
        surface: "studio", path: "force-app/main/default/aiAuthoringBundles/Help/Help.agent", dirty: true, tool: "code", share: true, at: 1,
        diagnostics: [{ line: 1, column: 1, endLine: 1, endColumn: 2, severity: "error", message: "bad" }, { line: 2, column: 1, endLine: 2, endColumn: 2, severity: "warning", message: "meh" }],
        lastRun: { runId: "r1", engine: "simulate", turn: 2 },
      },
    };
    const { focusWindow, bringBack } = card();
    expect(await screen.findByText("Help.agent")).toBeTruthy();
    expect(screen.getByText("Salesforce Studio is open in another window")).toBeTruthy();
    expect(screen.getByText("dev · sandbox")).toBeTruthy();
    expect(screen.getByText(/Project target/)).toBeTruthy();
    expect(screen.getByText("Unsaved edits")).toBeTruthy();
    expect(screen.getByText("2 problems")).toBeTruthy();
    expect(screen.getByText(/Simulate run/)).toBeTruthy();
    expect(screen.getByText(/turn 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Focus Studio window" }));
    fireEvent.click(screen.getByRole("button", { name: "Bring back here" }));
    expect(focusWindow).toHaveBeenCalledTimes(1);
    expect(bringBack).toHaveBeenCalledTimes(1);
  });

  it("explains what appears when nothing is shared or selected", async () => {
    call.mockImplementation(async (method: string) =>
      method === "status" ? { ...status, selectedAlias: null, defaultOrg: "", orgs: [] } : respond(method));
    card();
    expect(await screen.findByText("No org selected")).toBeTruthy();
    expect(screen.getByText(/Shows here while you edit an agent/)).toBeTruthy();
    expect(screen.queryByText(/run$/)).toBeNull();
  });

  it("names a single problem and an org it cannot match", async () => {
    call.mockImplementation(async (method: string) => method === "status" ? { ...status, orgs: [], targetSource: "shared" } : respond(method));
    shared = { ok: true, shared: true, state: { surface: "studio", path: "Solo.agent", dirty: false, tool: null, share: true, at: 1, diagnostics: [{ line: 1, column: 1, endLine: 1, endColumn: 2, severity: "error", message: "bad" }] } };
    card();
    expect(await screen.findByText("1 problem")).toBeTruthy();
    expect(screen.getByText("dev")).toBeTruthy();
    expect(screen.getByText(/Default target/)).toBeTruthy();
    expect(screen.queryByText("Unsaved edits")).toBeNull();
  });

  it("re-reads the shared view on a timer and the org on a context change, and stops on unmount", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<SalesforceUiProvider client={{ call }}><SalesforceStudioDetachedCard pluginId="salesforce" projectId="p" focusWindow={vi.fn()} bringBack={vi.fn()} /></SalesforceUiProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(calls(STUDIO_RPC.viewGet)).toBe(1);
    expect(calls("status")).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(DETACHED_VIEW_REFRESH_MS); });
    expect(calls(STUDIO_RPC.viewGet)).toBe(2);
    await act(async () => { announceContextChanged("other"); await vi.advanceTimersByTimeAsync(1); });
    expect(calls("status")).toBe(1);
    await act(async () => { announceContextChanged("p"); await vi.advanceTimersByTimeAsync(1); });
    expect(calls("status")).toBe(2);
    await act(async () => { announceContextChanged(null); await vi.advanceTimersByTimeAsync(1); });
    expect(calls("status")).toBe(3);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(DETACHED_VIEW_REFRESH_MS * 3); });
    announceContextChanged("p");
    expect(calls(STUDIO_RPC.viewGet)).toBe(2);
    expect(calls("status")).toBe(3);
  });
});
