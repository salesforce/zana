/** @vitest-environment happy-dom */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { definePluginApp } from "@zana-ai/zcc-plugin-sdk/app";
import { collectTestPluginApp } from "@zana-ai/zcc-plugin-sdk/testing/app";
import {
  registerSalesforcePanels,
  parseSalesforceResource,
  RecordPanel,
  ObjectPanel,
  OrgContextPanel,
  ApexPanel,
  DeploymentsPanel,
  OperationsPanel,
} from "../../panels.js";
import {
  SalesforceUiProvider,
  OrgSwitcher,
  RecordInspector,
  ObjectInspector,
  RunSummary,
} from "../../ui.js";
import { ActionDialog } from "./components/ActionDialog.js";
import { readQueryDraft, writeQueryDraft } from "./components/drafts.js";
import { SoqlExplorerPanel } from "./soql/SoqlExplorerPanel.js";
import { SalesforceProjectTab } from "./SalesforceProjectTab.js";

vi.mock("./AgentScriptPanel.js", () => ({
  AgentforcePlaygroundPanel: ({ headerActions }: { headerActions?: React.ReactNode }) => <div>Agentforce script{headerActions}</div>,
}));
vi.mock("./AgentforcePreviewPanel.js", () => ({
  AgentforcePreviewPanel: () => <div>Agentforce conversation</div>,
}));
const navigate = { toCompose: vi.fn(), openThreadPanel: vi.fn() };

const org = {
  alias: "dev",
  kind: "sandbox" as const,
  orgId: "00D000000000001",
  username: "dev@example.com",
  apiVersion: "62.0",
  instanceUrl: "https://example.com",
};
const describeObject = {
  name: "Account",
  label: "Account",
  fields: [
    { name: "Id", label: "Record ID", type: "id", referenceTo: [] },
    {
      name: "OwnerId",
      label: "Owner",
      type: "reference",
      referenceTo: ["User"],
    },
  ],
};
const operation = {
  id: "op",
  projectId: "p",
  kind: "deploy.start" as const,
  title: "Deploy One",
  org,
  at: 1,
  state: "submitted" as const,
  jobId: "0Af000000000001",
  summary: "Submitted",
  data: { status: "Pending" },
};
const props = {
  pluginId: "salesforce",
  projectId: "p",
  orgAlias: "dev",
  threadId: "t",
};
const call = vi.fn();
const addQuote = vi.fn();
function respond(method: string, args?: Record<string, unknown>) {
  if (method === "status")
    return {
      ok: true,
      projectId: "p",
      projectName: "Project One",
      projectRoot: "/project",
      targetSource: "project",
      defaultOrg: "dev",
      orgs: [org],
      dxProject: true,
      apiVersion: "62.0",
    };
  if (method === "orgs") return { ok: true, orgs: [org], selectedAlias: "dev" };
  if (method === "operations.list")
    return { ok: true, operations: [operation] };
  if (method === "records.get")
    return {
      ok: true,
      org,
      record: {
        Id: "001000000000001",
        Name: "Acme",
        Owner: { Name: "Jo" },
        Empty: null,
      },
    };
  if (method === "soql.describeSObject")
    return { ok: true, describe: describeObject };
  if (method === "metadata.list")
    return { ok: true, records: [{ fullName: "One" }], truncated: true };
  if (method === "apex.logs")
    return {
      ok: true,
      data: {
        records: [
          {
            Id: "07L000000000001",
            Operation: "Apex test",
            Status: "Success",
            StartTime: "Today",
          },
        ],
      },
    };
  if (method === "logs.get")
    return { ok: true, body: "USER_DEBUG hello", truncated: true };
  if (method === "lwc.scan") return { ok: true, data: [{ name: "hello" }] };
  if (method === "soql.describeGlobal")
    return { ok: true, org, catalogs: { standard: [], tooling: [] } };
  if (method === "soql.history.list")
    return { ok: true, saved: [], recent: [] };
  if (method === "soql.query")
    return {
      ok: true,
      soql: args?.soql,
      sobjectName: "Account",
      records: [{ Id: "001000000000001", Name: "Acme" }],
      done: true,
      totalSize: 1,
    };
  return { ok: true };
}
beforeEach(() => {
  navigate.toCompose.mockClear();
  navigate.openThreadPanel.mockClear();
  localStorage.clear();
  addQuote.mockReset();
  call.mockReset();
  call.mockImplementation(async (method, args) => respond(method, args));
  Object.assign(globalThis, {
    __ZCC_PLUGIN_HOST__: {
      callRpc: (_id: string, method: string, args?: Record<string, unknown>) =>
        call(method, args),
    },
    __ZCC_PLUGIN_RUNTIME__: {
      useZccNavigate: () => navigate,
      useZccContext: () => ({ projectId: "p", threadId: "t" }),
      useComposer: () => ({
        scope: { kind: "thread", threadId: "t" },
        addQuote,
        focus: vi.fn(),
      }),
    },
  });
});
afterEach(() => {
  cleanup();
  delete (globalThis as any).__ZCC_PLUGIN_HOST__;
  delete (globalThis as any).__ZCC_PLUGIN_RUNTIME__;
});
const mount = (element: React.ReactNode) =>
  render(
    <SalesforceUiProvider client={{ call }}>{element}</SalesforceUiProvider>,
  );

describe("public Salesforce panels", () => {
  it('filters activity to its tool, exposes all activity and keeps the selected detail separate', async () => {
    call.mockImplementation(async method => method === 'operations.list' ? { ok: true, operations: [operation, { ...operation, id: 'test', kind: 'apex.test', title: 'InvoiceTest', state: 'succeeded', jobId: undefined }] } : respond(method));
    mount(<ApexPanel {...props} />);
    const activity = screen.getByRole('region', { name: 'Operation history' });
    await within(activity).findByRole('heading', { name: 'InvoiceTest' });
    expect(within(activity).queryByText('Deploy One')).toBeNull();
    fireEvent.click(within(activity).getByRole('button', { name: 'Show all activity' }));
    fireEvent.click(within(activity).getByRole('button', { name: /Deployment.*Deploy One/ }));
    await within(activity).findByRole('heading', { name: 'Deploy One' });
    fireEvent.change(within(activity).getByLabelText('Search operations'), { target: { value: 'missing' } });
    expect(within(activity).getByText('No matching activity')).toBeTruthy();
    fireEvent.change(within(activity).getByLabelText('Search operations'), { target: { value: 'Invoice' } });
    expect(within(activity).getByRole('heading', { name: 'InvoiceTest' })).toBeTruthy();
  });

  it('searches metadata, removes chips and retains selections when browsing another type', async () => {
    call.mockImplementation(async (method, args) => method === 'metadata.list' ? { ok: true, records: [{ fullName: 'Ten' }, { fullName: 'One' }] } : respond(method, args));
    mount(<DeploymentsPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse org metadata' }));
    await screen.findByLabelText('Select One');
    fireEvent.change(screen.getByLabelText('Search metadata'), { target: { value: 'one' } });
    expect(screen.queryByLabelText('Select Ten')).toBeNull();
    fireEvent.click(screen.getByLabelText('Select One'));
    expect(screen.getByText('1 selected')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Metadata type'), { target: { value: 'Flow' } });
    expect(screen.getByRole('button', { name: 'Remove ApexClass:One' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Browse org metadata' }));
    fireEvent.click(await screen.findByLabelText('Select Ten'));
    expect(screen.getByText('2 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove ApexClass:One' }));
    fireEvent.click(screen.getByText('Enter component names'));
    expect((screen.getByLabelText('Selected components') as HTMLTextAreaElement).value).toBe('Flow:Ten');
    fireEvent.change(screen.getByLabelText('Selected components'), { target: { value: 'ApexClass:Manual\nApexClass:Manual' } });
    expect(screen.getByText('1 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByRole('button', { name: 'Preview deployment' }).hasAttribute('disabled')).toBe(true);
  });

  it('filters logs and finds literal text in the selected log without changing its contents', async () => {
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      call.mockImplementation(async method => method === 'logs.get' ? { ok: true, body: 'line [error] one\nline [ERROR] two', truncated: true } : respond(method));
      mount(<ApexPanel {...props} onAddToPrompt={addQuote} />);
      fireEvent.click(screen.getByRole('tab', { name: 'Debug logs' }));
      await screen.findByRole('button', { name: /Apex test/ });
      fireEvent.change(screen.getByLabelText('Search debug logs'), { target: { value: 'missing' } });
      expect(screen.getByText('No matching logs')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Search debug logs'), { target: { value: 'success' } });
      fireEvent.click(screen.getByRole('button', { name: /Apex test/ }));
      await waitFor(() => expect(document.querySelector('.sf-log-code')?.textContent).toBe('line [error] one\nline [ERROR] two'));
      fireEvent.change(screen.getByLabelText('Find in log'), { target: { value: '[error]' } });
      expect(screen.getByText('2 matches')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
      fireEvent.keyDown(screen.getByLabelText('Find in log'), { key: 'Enter' });
      expect(scroll).toHaveBeenCalledTimes(2);
      expect(document.querySelectorAll('.sf-log-code mark')).toHaveLength(2);
      fireEvent.click(screen.getByRole('button', { name: 'Add log excerpt to prompt' }));
      expect(addQuote).toHaveBeenCalledWith(expect.stringContaining('line [error] one\nline [ERROR] two'));
      fireEvent.change(screen.getByLabelText('Find in log'), { target: { value: 'absent' } });
      expect(screen.getByRole('button', { name: 'Next match' }).hasAttribute('disabled')).toBe(true);
    } finally { HTMLElement.prototype.scrollIntoView = original; }
  });

  it("hands off anonymous Apex with the exact org and code without executing", async () => {
    mount(<ApexPanel {...props} threadId={undefined} onAddToPrompt={addQuote} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Anonymous Apex' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Anonymous Apex' }), { target: { value: 'System.debug(42);' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue in a thread' }));
    expect(addQuote).toHaveBeenCalledOnce();
    const draft = addQuote.mock.calls[0][0];
    expect(draft).toContain('do not execute automatically');
    expect(JSON.parse(draft.slice(draft.indexOf('{')))).toMatchObject({ operation: 'apex.anonymous', orgAlias: 'dev', body: 'System.debug(42);' });
    expect(call.mock.calls.some(([method]) => method === 'operations.start')).toBe(false);
  });

  it("carries selected metadata and tests into deployment and retrieval review", async () => {
    mount(<DeploymentsPanel {...props} threadId={undefined} onAddToPrompt={addQuote} />);
    fireEvent.click(screen.getByText('Browse org metadata'));
    fireEvent.click(await screen.findByLabelText('Select One'));
    fireEvent.change(screen.getByLabelText('Targeted Apex tests'), { target: { value: 'OneTest, TwoTest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review deployment in a thread' }));
    fireEvent.click(screen.getByText('Retrieve from org'));
    fireEvent.click(screen.getByRole('button', { name: 'Review retrieval in a thread' }));
    expect(addQuote.mock.calls.map(([draft]) => JSON.parse(draft.slice(draft.indexOf('{'))))).toEqual([
      { operation: 'deploy.start', orgAlias: 'dev', components: ['ApexClass:One'], tests: ['OneTest', 'TwoTest'] },
      { operation: 'retrieve.start', orgAlias: 'dev', components: ['ApexClass:One'], tests: ['OneTest', 'TwoTest'] },
    ]);
    expect(call.mock.calls.some(([method]) => method === 'operations.start')).toBe(false);
  });

  it("disables standalone writes when no thread handoff is available", async () => {
    mount(<ApexPanel {...props} threadId={undefined} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Anonymous Apex' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Anonymous Apex' }), { target: { value: 'System.debug(42);' } });
    expect(screen.getByRole('button', { name: 'Continue in a thread' }).hasAttribute('disabled')).toBe(true);
  });

  it("refreshes an empty debug log list without leaving the panel", async () => {
    call.mockImplementation(async method => method === 'apex.logs' ? { ok: true, data: { records: [] } } : respond(method));
    mount(<ApexPanel {...props} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Debug logs' }));
    await screen.findByText(/No debug logs/);
    call.mockImplementation(async method => respond(method));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh logs' }));
    await screen.findByText('Apex test');
    expect(call.mock.calls.filter(([method]) => method === 'apex.logs')).toHaveLength(2);
  });

  it("keeps project workflows scoped while staging evidence and navigating tools", async () => {
    call.mockImplementation(async (method, args) =>
      method === "doctor"
        ? { cliOk: true, org, agentBundleCount: 2 }
        : respond(method, args),
    );
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    await screen.findByText("Ready for your next change.");
    fireEvent.click(screen.getByRole("button", { name: "Check project" }));
    await screen.findByText(/Salesforce CLI available.*dev connected/);
    fireEvent.click(
      screen.getByRole("button", { name: "Add result to prompt" }),
    );
    expect(navigate.toCompose).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPrompt: expect.stringContaining("Target org: dev"),
        focusPrompt: true,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Org details" }));
    await screen.findByLabelText("Search connected orgs");
    fireEvent.click(screen.getByRole("button", { name: "Org details" }));
    fireEvent.click(screen.getByRole("button", { name: /Explore data/ }));
    expect(screen.getByTestId("soql-editor")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Apex & logs" }));
    expect(screen.getByRole("button", { name: /Run targeted/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Deployments" }));
    expect(screen.getByLabelText("Targeted Apex tests")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Agentforce" }));
    expect(screen.getByText("Agentforce script")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Org preview", exact: true }),
    );
    expect(screen.getByText("Agentforce conversation")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open beside agent" }));
    expect(navigate.openThreadPanel).toHaveBeenCalledWith({
      actionId: "preview",
      params: { projectId: "p", orgAlias: "dev" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Back to studio", exact: true }),
    );
    expect(screen.getByText("Agentforce script")).toBeTruthy();
    expect(call).toHaveBeenCalledWith(
      "doctor",
      expect.objectContaining({ projectId: "p", threadId: "t" }),
    );
  });

  it("offers project connection recovery without a target and preserves doctor failures", async () => {
    call.mockImplementation(async (method, args) =>
      method === "status"
        ? {
            ...respond(method, args),
            defaultOrg: "",
            orgs: [],
            targetSource: "shared",
            dxProject: false,
          }
        : method === "doctor"
          ? { ok: false, error: "Connection expired" }
          : respond(method, args),
    );
    mount(<SalesforceProjectTab pluginId="salesforce" projectId="p" />);
    await screen.findByText("Connect your Salesforce project.");
    fireEvent.click(
      screen.getByRole("button", { name: "Connect or select an org" }),
    );
    await screen.findByLabelText("Search connected orgs");
    fireEvent.click(screen.getByRole("button", { name: "Check project" }));
    await screen.findByText("Connection expired");
    call.mockImplementation(async (method, args) =>
      method === "doctor"
        ? { cliOk: false, agentBundleCount: 0 }
        : respond(method, args),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check project" }));
    await screen.findByText(
      /Salesforce CLI unavailable.*No active org connection/,
    );
  });

  it("discards a delayed connection check after changing projects", async () => {
    let resolveDoctor!: (value: unknown) => void;
    call.mockImplementation(async (method, args) =>
      method === "doctor"
        ? new Promise((resolve) => {
            resolveDoctor = resolve;
          })
        : respond(method, args),
    );
    const view = mount(
      <SalesforceProjectTab pluginId="salesforce" projectId="p" />,
    );
    await screen.findByText("Ready for your next change.");
    fireEvent.click(screen.getByRole("button", { name: "Check project" }));
    view.rerender(
      <SalesforceUiProvider client={{ call }}>
        <SalesforceProjectTab pluginId="salesforce" projectId="next-project" />
      </SalesforceUiProvider>,
    );
    await screen.findByText("Ready for your next change.");
    await act(async () =>
      resolveDoctor({
        cliOk: true,
        org: { ...org, alias: "previous-target" },
        agentBundleCount: 0,
      }),
    );
    expect(screen.queryByText(/previous-target connected/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Check project" }),
    ).not.toHaveProperty("disabled", true);
  });

  it("keeps an explicit missing target visible instead of displaying another org", () => {
    const orgs = [{ ...org, isDefault: true, connectedStatus: "Connected" }];
    const { rerender } = render(
      <OrgSwitcher orgs={orgs} value="removed-org" onChange={vi.fn()} />,
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
      "removed-org",
    );
    expect(
      screen.getByRole("option", {
        name: "removed-org (not in connected list)",
      }),
    ).toBeTruthy();
    rerender(<OrgSwitcher orgs={orgs} value="" onChange={vi.fn()} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("option", { name: "Choose an org" })).toBeTruthy();
  });

  it("registers consumer-owned native slots and seeds a record using the explicit Salesforce client", async () => {
    const consumer = collectTestPluginApp(
      definePluginApp((app) =>
        registerSalesforcePanels(app, { panels: ["record", "soql"] }),
      ),
      "other-plugin",
    );
    expect(consumer.threadPanelActions.map((row) => row.id)).toEqual([
      "sf-record",
      "sf-soql",
    ]);
    expect(consumer.threadPanelActions[0].scopes).toEqual([
      "thread",
      "agent-session",
    ]);
    expect(consumer.threadPanelActions[0].pluginId).toBe("other-plugin");
    const Panel = consumer.threadPanelActions[0].component;
    render(
      <Panel
        pluginId="other-plugin"
        threadId="t"
        params={{
          version: 1,
          objectName: "Account",
          recordId: "001000000000001",
          projectId: "p",
          orgAlias: "dev",
        }}
      />,
    );
    await screen.findByRole("heading", { name: "Acme" });
    fireEvent.click(
      screen.getByRole("button", { name: "Add displayed fields to prompt" }),
    );
    expect(addQuote).toHaveBeenCalledWith(expect.stringContaining("Acme"));
    expect(call).toHaveBeenCalledWith(
      "records.get",
      expect.objectContaining({
        projectId: "p",
        orgAlias: "dev",
        threadId: "t",
      }),
    );
    const openPanel = vi.fn();
    consumer.messageActions[0].run({
      threadId: "t",
      message: {} as never,
      selectedText: "SELECT Id FROM Account LIMIT 5",
      openPanel,
    });
    expect(openPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { version: 1, query: "SELECT Id FROM Account LIMIT 5" },
      }),
    );
    const command = consumer.commandPaletteActions[0];
    expect(command.isAvailable?.({ threadId: null } as never)).toBe(false);
    command.run({ threadId: "t", projectId: "p", openPanel } as never);
    expect(openPanel).toHaveBeenLastCalledWith({
      actionId: "sf-record",
      params: { version: 1, projectId: "p" },
    });
  });

  it("rejects oversized descriptors and future versions", () => {
    expect(parseSalesforceResource(null)).toEqual({});
    expect(parseSalesforceResource([])).toEqual({});
    expect(parseSalesforceResource({ version: 2, projectId: "p" })).toEqual({});
    expect(
      parseSalesforceResource({
        version: 1,
        query: "x".repeat(20_001),
        token: "bad",
        path: "a",
      }),
    ).toEqual({ version: 1, path: "a" });
  });

  it.each(["t", "cli-session"])(
    "uses the owning project for native panel %s independently of the route",
    async (threadId) => {
      const consumer = collectTestPluginApp(
        definePluginApp((app) =>
          registerSalesforcePanels(app, { panels: ["record"] }),
        ),
        "salesforce",
      );
      const Panel = consumer.threadPanelActions[0].component;
      render(
        <Panel
          pluginId="salesforce"
          projectId="owner-project"
          threadId={threadId}
          params={{
            version: 1,
            objectName: "Account",
            recordId: "001000000000001",
          }}
        />,
      );
      await screen.findByRole("heading", { name: "Acme" });
      expect(call).toHaveBeenCalledWith(
        "records.get",
        expect.objectContaining({ projectId: "owner-project", threadId }),
      );
      if (threadId !== "t")
        expect(
          screen.queryByRole("button", {
            name: "Add displayed fields to prompt",
          }),
        ).toBeNull();
    },
  );

  it("handles record lookup, unavailable services, retry, filtering and display-only fields", async () => {
    mount(<RecordPanel {...props} />);
    expect(screen.getByText("Inspect a Salesforce record")).toBeTruthy();
    call.mockRejectedValueOnce(Error("Plugin unavailable"));
    fireEvent.change(screen.getByLabelText("Record id"), {
      target: { value: "001000000000001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByText("Try again"));
    await screen.findByRole("heading", { name: "Acme" });
    fireEvent.change(screen.getByLabelText("Find record field"), {
      target: { value: "owner" },
    });
    expect(screen.getByText('{"Name":"Jo"}')).toBeTruthy();
    expect(screen.queryByText("Empty")).toBeNull();
  });

  it("inspects object fields and selected project context", async () => {
    const view = mount(<ObjectPanel {...props} />);
    await screen.findByText("OwnerId");
    fireEvent.change(screen.getByLabelText("Find object field"), {
      target: { value: "owner" },
    });
    expect(screen.getByText("reference → User")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Object API name"), {
      target: { value: "Contact" },
    });
    fireEvent.click(screen.getByText("Inspect"));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "soql.describeSObject",
        expect.objectContaining({ sobject: "Contact" }),
      ),
    );
    view.unmount();
    mount(<OrgContextPanel {...props} />);
    await screen.findByText("Project One");
    expect(screen.getByText("/project")).toBeTruthy();
  });

  it("refreshes saved operation reports and surfaces report errors", async () => {
    mount(<OperationsPanel {...props} onAddToPrompt={addQuote} />);
    await screen.findByText("Refresh report");
    fireEvent.click(screen.getByText("Add result to prompt"));
    expect(addQuote).toHaveBeenCalledWith(expect.stringContaining("Pending"));
    call.mockImplementation(async (method) =>
      method === "operations.report"
        ? { ok: false, error: "Approval required" }
        : respond(method),
    );
    fireEvent.click(screen.getByText("Refresh report"));
    await screen.findByRole("alert");
    call.mockImplementation(async method => respond(method));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(call.mock.calls.filter(([method]) => method === 'operations.report')).toHaveLength(2);
  });

  it("supports keyboard navigation, targeted tests, logs, LWC and anonymous drafts", async () => {
    mount(<ApexPanel {...props} onAddToPrompt={addQuote} />);
    const testsTab = screen.getByRole("tab", { name: "Tests" });
    fireEvent.keyDown(testsTab, { key: "ArrowRight" });
    await screen.findByText("Apex test");
    fireEvent.click(screen.getByText("Apex test"));
    await screen.findByText("USER_DEBUG hello");
    fireEvent.click(screen.getByText("Add log excerpt to prompt"));
    expect(addQuote).toHaveBeenCalledWith(
      expect.stringContaining("USER_DEBUG"),
    );
    fireEvent.click(screen.getByRole("tab", { name: "LWC" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("lwc.scan", expect.anything()),
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "LWC" }), { key: "End" });
    fireEvent.change(screen.getByRole('textbox', { name: 'Anonymous Apex' }), {
      target: { value: "System.debug(1);" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Review and run/ }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "operations.start",
        expect.objectContaining({
          kind: "apex.anonymous",
          body: "System.debug(1);",
        }),
      ),
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "Anonymous Apex" }), {
      key: "Home",
    });
    fireEvent.change(screen.getByLabelText("Apex test class"), {
      target: { value: "OneTest" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Run targeted/ }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "operations.start",
        expect.objectContaining({ kind: "apex.test", className: "OneTest" }),
      ),
    );
  });

  it("browses metadata and preserves explicit selection through preview, validation and retrieval", async () => {
    mount(<DeploymentsPanel {...props} />);
    fireEvent.click(screen.getByText("Browse org metadata"));
    await screen.findByLabelText("Select One");
    fireEvent.click(screen.getByLabelText("Select One"));
    fireEvent.change(screen.getByLabelText("Targeted Apex tests"), {
      target: { value: "OneTest" },
    });
    fireEvent.click(screen.getByText("Preview deployment"));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "operations.start",
        expect.objectContaining({
          kind: "deploy.preview",
          components: ["ApexClass:One"],
          tests: ["OneTest"],
        }),
      ),
    );
    fireEvent.click(screen.getByText("Validate"));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "operations.start",
        expect.objectContaining({ kind: "deploy.validate" }),
      ),
    );
    fireEvent.click(screen.getByText("Review and deploy"));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "operations.start",
        expect.objectContaining({ kind: "deploy.start" }),
      ),
    );
    fireEvent.click(screen.getByText("Retrieve from org"));
    fireEvent.click(screen.getByText("Preview tracked changes"));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "operations.start",
        expect.objectContaining({ kind: "retrieve.preview" }),
      ),
    );
    fireEvent.click(screen.getByText("Review and retrieve selected"));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "operations.start",
        expect.objectContaining({ kind: "retrieve.start" }),
      ),
    );
  });

  it("ignores late results after changing org while keeping unsent query drafts", async () => {
    let resolve!: (value: unknown) => void;
    call.mockImplementation((method, args) =>
      method === "soql.query"
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve(respond(method, args)),
    );
    const view = mount(
      <SoqlExplorerPanel
        {...props}
        initialQuery="SELECT Name FROM Account LIMIT 5"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("soql-run").hasAttribute("disabled")).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByTestId("soql-run"));
    view.rerender(
      <SalesforceUiProvider client={{ call }}>
        <SoqlExplorerPanel {...props} orgAlias="other" />
      </SalesforceUiProvider>,
    );
    await act(async () => {
      resolve({ ok: true, records: [{ Name: "Old org record" }] });
    });
    expect(screen.queryByText("Old org record")).toBeNull();
    expect(
      (screen.getByTestId("soql-editor") as HTMLTextAreaElement).value,
    ).toContain("SELECT");
  });

  it("bounds local drafts and keeps dialog focus stable while editing", async () => {
    for (let i = 0; i < 35; i++) writeQueryDraft(String(i), "x".repeat(21_000));
    expect(readQueryDraft("0", "gone")).toBe("gone");
    expect(readQueryDraft("34", "").length).toBe(20_000);
    localStorage.setItem("salesforce.query-drafts.v1", "invalid");
    expect(readQueryDraft("a", "fallback")).toBe("fallback");
    const close = vi.fn();
    const confirm = vi.fn();
    render(
      <ActionDialog
        title="Save query"
        input="Query"
        onClose={close}
        onConfirm={confirm}
      />,
    );
    const input = screen.getByLabelText("Name");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "Accounts" } });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("Continue"));
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(input);
    fireEvent.click(screen.getByText("Continue"));
    expect(confirm).toHaveBeenCalledWith("Accounts");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(close).toHaveBeenCalled();
  });
});
