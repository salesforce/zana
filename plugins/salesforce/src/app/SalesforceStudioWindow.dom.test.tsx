/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      return <div data-testid="script">Agentforce script<input aria-label="Unsaved script" defaultValue="draft" />{headerActions}</div>;
    },
  };
});

const org = { alias: "dev", kind: "sandbox" as const, orgId: "00D000000000001", username: "dev@example.com", apiVersion: "62.0", instanceUrl: "https://example.com" };
const status = { ok: true, projectId: "p", projectName: "Project One", projectRoot: "/project", targetSource: "project", selectedAlias: "dev", defaultOrg: "dev", orgs: [org], dxProject: true };
const navigate = { toCompose: vi.fn(), openThreadPanel: vi.fn(), toProject: vi.fn() };
const call = vi.fn();
const useWindowTitle = vi.fn();
let surface: string | undefined;
let resourceId: string | undefined;
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
  navigate.toProject.mockClear();
  call.mockImplementation(async (method: string) => respond(method));
  surface = "plugin-view"; resourceId = undefined;
  shared = { ok: true, shared: false, state: null };
  Object.assign(globalThis, {
    __ZCC_PLUGIN_HOST__: { callRpc: (_id: string, method: string, args?: Record<string, unknown>) => call(method, args) },
    __ZCC_PLUGIN_RUNTIME__: {
      useZccNavigate: () => navigate,
      useZccContext: () => ({ projectId: "p", threadId: null, ...(surface ? { surface } : {}), ...(resourceId ? { resourceId } : {}) }),
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

function chooseSection(id: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Open Salesforce tools' }));
  fireEvent.click(screen.getByRole('dialog').querySelector(`[data-section="${id}"]`)!);
}

describe("Salesforce Studio window", () => {
  it("publishes its fixed AgentScript identity and refuses retargeting another resource", async () => {
    resourceId = "force-app/main/default/aiAuthoringBundles/Help/Help.agent";
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    expect(control.options!.state()).toMatchObject({ resourceId, path: resourceId });
    expect(() => control.options!.execute({ command: "view.open", input: { view: "agentforce", path: "Other.agent" }, user: true })).toThrow(/another AgentScript/);
    await act(async () => { control.options!.execute({ command: "view.open", input: { view: "agentforce", path: resourceId }, user: true }); });
  });

  it("treats a returned resource in the main window as selection, not a locked workspace", async () => {
    surface = "main"; resourceId = "Help.agent";
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    expect(control.options!.state()).not.toHaveProperty("resourceId");
    await act(async () => { control.options!.execute({ command: "view.open", input: { view: "agentforce", path: "Other.agent" }, user: true }); });
    expect(screen.getByTestId("script")).toBeTruthy();
  });

  it("shows only the Agentforce Studio: no activity bar, no general views", async () => {
    localStorage.setItem("salesforce:studio-window:p", "deployments");
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    expect(screen.getByTestId("salesforce-workbench").getAttribute("data-surface")).toBe("studio-window");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByTestId("script")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open beside agent" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Salesforce org" }).getAttribute("disabled")).toBeNull());
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
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Salesforce org" }).getAttribute("disabled")).toBeNull());
    expect(useWindowTitle).toHaveBeenLastCalledWith({ title: "Agentforce · Help", detail: "prod", badge: "Production", tone: "danger" });
  });

  it("warns when the selected org is not one the CLI lists", async () => {
    call.mockImplementation(async (method: string) => method === "status" ? { ...status, selectedAlias: "gone", orgs: [org] } : respond(method));
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Salesforce org" }).getAttribute("disabled")).toBeNull());
    expect(useWindowTitle).toHaveBeenLastCalledWith({ title: "Agentforce · Help", detail: "gone", badge: "Unknown org", tone: "warning" });
  });

  it("names the view and org, and badges only production or unknown orgs that are selected", () => {
    expect(studioWindowTitle({ agentPath: null, alias: "" })).toEqual({ title: "Agentforce" });
    expect(studioWindowTitle({ agentPath: "a/b/Help.AGENT", alias: "dev", orgKind: "sandbox" })).toEqual({ title: "Agentforce · Help", detail: "dev" });
    expect(studioWindowTitle({ agentPath: "a/Help.agent", alias: "x", orgKind: "unknown" })).toEqual({ title: "Agentforce · Help", detail: "x", badge: "Unknown org", tone: "warning" });
    expect(studioWindowTitle({ agentPath: null, alias: "", orgKind: "production" })).toEqual({ title: "Agentforce" });
  });

  it("offers all tools through the compact launcher in the main window", () => {
    surface = undefined;
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    expect(useWindowTitle).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: 'Open Salesforce tools' }).textContent).toContain('Overview');
    fireEvent.click(screen.getByRole('button', { name: 'Open Salesforce tools' }));
    expect(screen.getByTestId("salesforce-workbench").getAttribute("data-surface")).toBeNull();
    expect(screen.getByRole('dialog').querySelectorAll('[data-section]')).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "Open beside agent" })).toBeNull();
  });

  it('preserves the mounted Studio and its draft when switching tools', async () => {
    surface = undefined;
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    chooseSection('agentforce');
    const script = screen.getByTestId('script');
    const draft = screen.getByRole('textbox', { name: 'Unsaved script' });
    fireEvent.change(draft, { target: { value: 'keep this unsaved edit' } });
    chooseSection('overview');
    expect(script.closest('[hidden]')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Unsaved script' })).toBeNull();
    chooseSection('agentforce');
    expect(screen.getByTestId('script')).toBe(script);
    expect((screen.getByRole('textbox', { name: 'Unsaved script' }) as HTMLInputElement).value).toBe('keep this unsaved edit');
  });

  it('accepts exact section requests for this project from another window and removes its listener', async () => {
    surface = undefined;
    const { unmount } = mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    localStorage.setItem('salesforce:project-tab:p', 'deployments');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'salesforce:project-tab:other' })); });
    expect(screen.getByRole('button', { name: 'Open Salesforce tools' }).textContent).toContain('Overview');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'salesforce:project-tab:p' })); });
    expect(screen.getByRole('region', { name: 'Deployments' })).toBeTruthy();
    const remove = vi.spyOn(window, 'removeEventListener');
    unmount();
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function));
    remove.mockRestore();
  });

  it('opens the requested general tool in main without changing the dedicated agent', () => {
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    const script = screen.getByTestId('script');
    chooseSection('data');
    expect(navigate.toProject).toHaveBeenLastCalledWith('p', { tabId: 'salesforce', inMainWindow: true });
    expect(localStorage.getItem('salesforce:project-tab:p')).toBe('data');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'salesforce:project-tab:p' })); });
    expect(screen.getByRole('region', { name: 'Agentforce' })).toBeTruthy();
    expect(screen.getByTestId('script')).toBe(script);
  });
});

describe("Salesforce tools link", () => {
  it("sends the Studio window to the main window project and hides in the main window", () => {
    mount(<SalesforceToolsLink projectId="p" />);
    fireEvent.click(screen.getByRole("button", { name: /Salesforce/ }));
    expect(navigate.toProject).toHaveBeenCalledWith("p", { tabId: "salesforce", inMainWindow: true });
    openSalesforceTools(navigate, "q");
    expect(navigate.toProject).toHaveBeenLastCalledWith("q", { tabId: "salesforce", inMainWindow: true });
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
    fireEvent.click(screen.getByRole('button', { name: 'Open Salesforce tools' }));
    expect(screen.getByRole('dialog').querySelectorAll('[data-section]')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Close Salesforce tools' }));
    expect(screen.queryByTestId("script")).toBeNull();
    chooseSection('deployments');
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
    expect(screen.getByRole('button', { name: 'Open Salesforce tools' }).textContent).toContain('Overview');
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
    expect(screen.getByRole('button', { name: 'Open Salesforce tools' }).textContent).toContain('Data');
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
