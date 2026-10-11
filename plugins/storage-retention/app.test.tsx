/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@zana-ai/zcc-plugin-sdk/testing/app";
import type { Policy, State } from "./src/state-types.js";
import type { HostStorageListResponse, HostStorageThread } from "./src/storage-types.js";

const app = await loadPluginApp(() => import("./app.tsx"), "storage-retention");
const panel = app.navPanels[0]!;

afterEach(() => {
  cleanup();
});

type HostRow = HostStorageListResponse["hosts"][number];
type Report = NonNullable<HostRow["report"]>;

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const off: Policy = { archiveAfterDays: null, clearAfterDays: null, clearStorageOnArchive: false };

function report(overrides: Partial<Report> = {}): Report {
  return {
    hostId: "host_a",
    scannedAt: Date.now() - 5 * 60_000,
    disk: { totalBytes: 500 * GB, freeBytes: 120 * GB },
    activeThreadBytes: 2 * GB,
    archivedThreadBytes: 3 * GB,
    orphanBytes: 0,
    threadsWithStorageCount: 10,
    archivedThreadCount: 4,
    orphanCount: 0,
    partialCount: 0,
    hiddenThreads: { activeCount: 0, activeBytes: 0, archivedCount: 0, archivedBytes: 0 },
    archivedFiles: { threadCount: 4, bytes: 3 * GB },
    archivedLargeFiles: { threadCount: 2, fileCount: 3, bytes: 2 * GB },
    largestThreads: [],
    ...overrides,
  };
}
function row(hostId: string, hostName: string, overrides: Partial<HostRow> = {}): HostRow {
  return {
    hostId,
    hostName,
    report: null,
    scan: { state: "idle" },
    largeFileCleanup: { state: "idle" },
    archivedFileCleanup: { state: "idle" },
    maintenance: { state: "idle" },
    ...overrides,
  };
}
function thread(n: number, overrides: Partial<HostStorageThread> = {}): HostStorageThread {
  return {
    threadId: `thr_${n}`,
    projectId: "project_a",
    title: `Thread ${n}`,
    archivedAt: null,
    updatedAt: 1,
    running: false,
    hidden: false,
    pinned: false,
    sizeBytes: (100 - n) * MB,
    ...overrides,
  };
}

interface Backend {
  state: State;
  hosts: HostRow[];
}
/** Answers every panel method from `db`; `overrides` replace single methods. */
function backend(initial: Partial<Backend> = {}, overrides: Record<string, (input: unknown) => unknown> = {}) {
  const db: Backend = { state: { policy: off, lastRun: null }, hosts: [], ...initial };
  const rpc: Record<string, ReturnType<typeof vi.fn>> = {
    state: vi.fn(async () => db.state),
    hosts: vi.fn(async () => ({ hosts: db.hosts })),
    scanHost: vi.fn(async () => ({})),
    scanAll: vi.fn(async () => ({ hosts: db.hosts })),
    startClearLargeFiles: vi.fn(async () => null),
    startClearArchivedFiles: vi.fn(async () => null),
    startRemoveOrphans: vi.fn(async () => null),
    clearThread: vi.fn(async () => ({ ok: true })),
    preview: vi.fn(async () => ({ archiveCount: 3, clearCount: 2 })),
    configure: vi.fn(async (input: unknown) => {
      db.state = { ...db.state, policy: input as Policy };
      return db.state;
    }),
  };
  for (const [name, handler] of Object.entries(overrides)) rpc[name] = vi.fn(async (input: unknown) => handler(input));
  return { db, rpc };
}
function mount(rpc: ReturnType<typeof backend>["rpc"], subPath = "") {
  return renderSlot(panel, { pluginId: "storage-retention", subPath }, { rpc: rpc as Record<string, (input: unknown) => unknown> });
}
const calls = (rpc: Record<string, ReturnType<typeof vi.fn>>, method: string) => rpc[method]!.mock.calls;
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const confirmBox = () => screen.getByRole("region", { name: "Confirm cleanup" });
const choose = (label: string, value: string) =>
  fireEvent.change(screen.getByRole("combobox", { name: label }), { target: { value } });
const archiveSelect = "Archive inactive threads";
const clearSelect = "Clear files of archived threads";
const onArchiveSwitch = "Clear files when a thread is archived";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("panel registration", () => {
  it("registers one navigation panel with the plugin's icon", () => {
    expect(app.navPanels).toHaveLength(1);
    expect(panel).toMatchObject({ id: "storage", path: "storage", title: "Storage & retention", icon: "DatabaseBackup" });
  });
});

describe("machine overview", () => {
  it("lists every machine with its cached usage and opens one", async () => {
    const { rpc } = backend({
      hosts: [
        row("host_a", "Build box", { report: report() }),
        row("host_b", "Laptop"),
        row("host_c", "Flaky", { scan: { state: "failed", failedAt: 1, message: "daemon unreachable" } }),
      ],
    });
    const slot = mount(rpc);

    await screen.findByRole("button", { name: "Build box" });
    expect(screen.getByText(/5 GB in 10 threads/)).toBeTruthy();
    expect(screen.getByText(/120 GB free/)).toBeTruthy();
    expect(screen.getByText(/scanned 5m ago/)).toBeTruthy();
    expect(screen.getByText("not scanned")).toBeTruthy();
    expect(screen.getByText("scan failed")).toBeTruthy();
    expect(screen.getByText("daemon unreachable")).toBeTruthy();

    click("Build box");
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toPluginPanel", path: "storage", options: { subPath: "host_a" } },
    ]);
  });

  it("says so when there are no machines", async () => {
    const { rpc } = backend();
    mount(rpc);

    await screen.findByText("No machines found");
    expect(screen.getByRole("button", { name: "Scan all" }).hasAttribute("disabled")).toBe(true);
  });

  it("scans one machine or all of them, and refreshes afterwards", async () => {
    const { rpc } = backend({ hosts: [row("host_a", "Build box", { report: report() }), row("host_b", "Laptop")] });
    mount(rpc);
    await screen.findByRole("button", { name: "Build box" });

    click("Rescan Build box");
    await waitFor(() => expect(calls(rpc, "scanHost")).toEqual([[{ hostId: "host_a" }]]));
    click("Scan Laptop");
    await waitFor(() => expect(calls(rpc, "scanHost")).toHaveLength(2));
    expect(calls(rpc, "scanHost")[1]).toEqual([{ hostId: "host_b" }]);
    click("Scan all");
    await waitFor(() => expect(calls(rpc, "scanAll")).toHaveLength(1));
    await waitFor(() => expect(calls(rpc, "hosts").length).toBeGreaterThanOrEqual(4));
  });

  it("does not offer a scan for a machine that is already scanning", async () => {
    const { rpc } = backend({ hosts: [row("host_a", "Build box", { scan: { state: "scanning", startedAt: 1 } })] });
    mount(rpc);

    await screen.findByText("scanning…");
    expect(screen.getByRole("button", { name: "Scan Build box" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows why a scan could not start, without losing the list", async () => {
    const { rpc } = backend({ hosts: [row("host_a", "Build box")] }, {
      scanHost: () => {
        throw new Error("Machine is offline");
      },
    });
    mount(rpc);
    await screen.findByRole("button", { name: "Build box" });

    click("Scan Build box");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not start the scan");
    expect(alert.textContent).toContain("Machine is offline");
    expect(screen.getByRole("button", { name: "Build box" })).toBeTruthy();
  });

  it("shows a load failure, retries, and recovers", async () => {
    const { rpc } = backend({ hosts: [row("host_a", "Build box")] });
    rpc.hosts!.mockRejectedValueOnce(new Error("server unavailable"));
    mount(rpc);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("server unavailable");
    expect(screen.queryByText("Machine storage")).toBeNull();

    click("Try again");

    await screen.findByRole("button", { name: "Build box" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a stable loading state before the first answer", async () => {
    const gate = deferred<HostStorageListResponse>();
    const { rpc } = backend();
    rpc.hosts!.mockReturnValue(gate.promise);
    mount(rpc);

    expect(screen.getByRole("status").textContent).toContain("Loading storage");
    await act(async () => gate.resolve({ hosts: [row("host_a", "Build box")] }));
    await screen.findByRole("button", { name: "Build box" });
  });

  it("ignores an answer that arrives after a newer one", async () => {
    const stale = deferred<HostStorageListResponse>();
    const { rpc } = backend({ hosts: [row("host_a", "Old name")] });
    const slot = mount(rpc);
    await screen.findByRole("button", { name: "Old name" });

    rpc.hosts!.mockReturnValueOnce(stale.promise);
    await act(async () => slot.emitRealtime("changed"));
    rpc.hosts!.mockImplementation(async () => ({ hosts: [row("host_a", "New name")] }));
    await act(async () => slot.emitRealtime("changed"));
    await screen.findByRole("button", { name: "New name" });
    await act(async () => stale.resolve({ hosts: [row("host_a", "Stale name")] }));

    expect(screen.queryByRole("button", { name: "Stale name" })).toBeNull();
    expect(screen.getByRole("button", { name: "New name" })).toBeTruthy();
  });

  it("refreshes when the plugin reports a change, and follows policy changes made elsewhere", async () => {
    const { rpc, db } = backend({ hosts: [row("host_a", "Build box")] });
    const slot = mount(rpc);
    await screen.findByRole("button", { name: "Build box" });

    db.hosts = [row("host_a", "Build box", { report: report() })];
    await act(async () => slot.emitRealtime("changed"));
    await screen.findByText(/scanned 5m ago/);

    db.state = { policy: { ...off, archiveAfterDays: 90 }, lastRun: null };
    await act(async () => slot.emitRealtime("policy-changed"));
    await waitFor(() =>
      expect((screen.getByRole("combobox", { name: archiveSelect }) as HTMLSelectElement).value).toBe("90"),
    );
  });

  it("reports a failure to read the policy after a change signal", async () => {
    const { rpc } = backend({ hosts: [row("host_a", "Build box")] });
    const slot = mount(rpc);
    await screen.findByRole("button", { name: "Build box" });

    rpc.state!.mockRejectedValueOnce(new Error("state unavailable"));
    await act(async () => slot.emitRealtime("policy-changed"));

    expect((await screen.findByRole("alert")).textContent).toContain("state unavailable");
  });

  it("keeps a policy saved here when an older refresh finishes afterwards", async () => {
    const { rpc } = backend({ hosts: [row("host_a", "Build box")] });
    const slot = mount(rpc);
    await screen.findByRole("button", { name: "Build box" });

    const late = deferred<State>();
    rpc.state!.mockReturnValueOnce(late.promise);
    await act(async () => slot.emitRealtime("changed"));
    choose(archiveSelect, "30");
    await screen.findByText(/would archive 3 threads/);
    click("Save retention settings");
    await waitFor(() => expect(calls(rpc, "configure")).toHaveLength(1));
    await act(async () => late.resolve({ policy: off, lastRun: null }));

    expect((screen.getByRole("combobox", { name: archiveSelect }) as HTMLSelectElement).value).toBe("30");
  });

  it("drops a late answer after the panel is closed", async () => {
    const gate = deferred<HostStorageListResponse>();
    const { rpc } = backend();
    rpc.hosts!.mockReturnValue(gate.promise);
    const slot = mount(rpc);

    slot.unmount();
    await act(async () => gate.resolve({ hosts: [] }));

    expect(screen.queryByText("No machines found")).toBeNull();
  });
});

describe("large-file suggestion", () => {
  const big = (bytes: number) => report({ archivedLargeFiles: { threadCount: 2, fileCount: 3, bytes } });

  it("stays out of the way below the threshold", async () => {
    const { rpc } = backend({ hosts: [row("host_a", "Build box", { report: big(500 * MB) })] });
    mount(rpc);

    await screen.findByRole("button", { name: "Build box" });
    expect(screen.queryByRole("button", { name: "Delete large files" })).toBeNull();
  });

  it("offers to delete large files from every machine, only after confirmation", async () => {
    const { rpc } = backend({
      hosts: [row("host_a", "Build box", { report: big(2 * GB) }), row("host_b", "Laptop", { report: big(GB) })],
    });
    mount(rpc);
    await screen.findByText(/Free up 3 GB from archived threads/);

    click("Delete large files");
    const box = confirmBox();
    expect(within(box).getByText(/Delete 6 large files \(3 GB\)\?/)).toBeTruthy();
    expect(box.textContent).toContain("Pinned and running threads are skipped");
    expect(calls(rpc, "startClearLargeFiles")).toHaveLength(0);

    fireEvent.click(within(box).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region", { name: "Confirm cleanup" })).toBeNull();
    expect(calls(rpc, "startClearLargeFiles")).toHaveLength(0);

    click("Delete large files");
    fireEvent.click(within(confirmBox()).getByRole("button", { name: "Delete large files" }));
    await waitFor(() => expect(calls(rpc, "startClearLargeFiles")).toEqual([[{ hostId: null }]]));
    await screen.findByText("Large-file cleanup started in the background.");
    expect(screen.queryByRole("region", { name: "Confirm cleanup" })).toBeNull();
  });

  it("keeps the confirmation and says why when the cleanup cannot start", async () => {
    const { rpc } = backend(
      { hosts: [row("host_a", "Build box", { report: big(2 * GB) })] },
      {
        startClearLargeFiles: () => {
          throw new Error("Another cleanup is already running");
        },
      },
    );
    mount(rpc);
    await screen.findByText(/Free up 2 GB/);

    click("Delete large files");
    fireEvent.click(within(confirmBox()).getByRole("button", { name: "Delete large files" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Another cleanup is already running");
    expect(confirmBox()).toBeTruthy();
  });

  it("shows progress while a machine is deleting, and blocks a second run", async () => {
    const { rpc } = backend({
      hosts: [
        row("host_a", "Build box", { report: big(2 * GB), largeFileCleanup: { state: "running", startedAt: 1 } }),
      ],
    });
    mount(rpc);

    await screen.findByText(/Build box: Deleting large files/);
    expect(screen.getByRole("button", { name: "Delete large files" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("automatic retention", () => {
  const withMachine = () => backend({ hosts: [row("host_a", "Build box")] });

  it("starts with everything off and says so", async () => {
    const { rpc } = withMachine();
    mount(rpc);

    await screen.findByRole("button", { name: "Build box" });
    const section = screen.getByRole("region", { name: "Automatic retention" });
    expect(within(section).getByText("Off")).toBeTruthy();
    expect((screen.getByRole("combobox", { name: archiveSelect }) as HTMLSelectElement).value).toBe("never");
    expect((screen.getByRole("combobox", { name: clearSelect }) as HTMLSelectElement).value).toBe("never");
    expect((screen.getByRole("switch", { name: onArchiveSwitch }) as HTMLInputElement).checked).toBe(false);
    expect(section.textContent).toContain("Pinned threads are never archived or cleared");
  });

  it("previews a stricter setting and saves it only after confirmation", async () => {
    const { rpc } = withMachine();
    mount(rpc);
    await screen.findByRole("button", { name: "Build box" });

    choose(archiveSelect, "30");

    const review = await screen.findByRole("region", { name: "Review retention change" });
    await within(review).findByText(/would archive 3 threads and clear the files of 2 archived threads/);
    expect(calls(rpc, "preview")).toEqual([[{ archiveAfterDays: 30, clearAfterDays: null, clearStorageOnArchive: false }]]);
    expect(calls(rpc, "configure")).toHaveLength(0);
    expect((screen.getByRole("combobox", { name: archiveSelect }) as HTMLSelectElement).value).toBe("30");

    fireEvent.click(within(review).getByRole("button", { name: "Save retention settings" }));

    await waitFor(() =>
      expect(calls(rpc, "configure")).toEqual([
        [{ archiveAfterDays: 30, clearAfterDays: null, clearStorageOnArchive: false }],
      ]),
    );
    await waitFor(() => expect(screen.queryByRole("region", { name: "Review retention change" })).toBeNull());
    expect(within(screen.getByRole("region", { name: "Automatic retention" })).getByText("Checks hourly")).toBeTruthy();
  });

  it("puts the setting back when the review is cancelled", async () => {
    const { rpc } = withMachine();
    mount(rpc);
    await screen.findByRole("button", { name: "Build box" });

    choose(clearSelect, "90");
    const review = await screen.findByRole("region", { name: "Review retention change" });
    fireEvent.click(within(review).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("region", { name: "Review retention change" })).toBeNull();
    expect((screen.getByRole("combobox", { name: clearSelect }) as HTMLSelectElement).value).toBe("never");
    expect(calls(rpc, "configure")).toHaveLength(0);
  });

  it("reviews turning on clearing at archive time and explains the undo window", async () => {
    const { rpc } = withMachine();
    mount(rpc);
    await screen.findByRole("button", { name: "Build box" });

    fireEvent.click(screen.getByRole("switch", { name: onArchiveSwitch }));

    const review = await screen.findByRole("region", { name: "Review retention change" });
    await within(review).findByText(/cleared about 30 seconds after archiving/);
    expect(calls(rpc, "preview")[0]).toEqual([{ archiveAfterDays: null, clearAfterDays: null, clearStorageOnArchive: true }]);
  });

  it("folds several pending changes into one review", async () => {
    const { rpc } = withMachine();
    mount(rpc);
    await screen.findByRole("button", { name: "Build box" });

    choose(archiveSelect, "30");
    await screen.findByRole("region", { name: "Review retention change" });
    choose(clearSelect, "180");

    await waitFor(() => expect(calls(rpc, "preview")).toHaveLength(2));
    expect(calls(rpc, "preview")[1]).toEqual([{ archiveAfterDays: 30, clearAfterDays: 180, clearStorageOnArchive: false }]);
    expect(screen.getAllByRole("region", { name: "Review retention change" })).toHaveLength(1);

    choose(archiveSelect, "never");
    choose(clearSelect, "never");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Review retention change" })).toBeNull());
    expect(calls(rpc, "configure")).toHaveLength(0);
  });

  it("saves a change that can only keep more straight away, without a review", async () => {
    const { rpc } = backend({
      state: { policy: { archiveAfterDays: 30, clearAfterDays: 90, clearStorageOnArchive: true }, lastRun: null },
      hosts: [row("host_a", "Build box")],
    });
    mount(rpc);
    await screen.findByRole("button", { name: "Build box" });

    choose(archiveSelect, "never");

    await waitFor(() =>
      expect(calls(rpc, "configure")).toEqual([[{ archiveAfterDays: null, clearAfterDays: 90, clearStorageOnArchive: true }]]),
    );
    expect(calls(rpc, "preview")).toHaveLength(0);
    await waitFor(() =>
      expect((screen.getByRole("switch", { name: onArchiveSwitch }) as HTMLInputElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("switch", { name: onArchiveSwitch }));
    await waitFor(() => expect(calls(rpc, "configure")).toHaveLength(2));
    expect(calls(rpc, "preview")).toHaveLength(0);
  });

  it("keeps the review open and says so when saving fails, then saves on retry", async () => {
    const { rpc } = withMachine();
    rpc.configure!.mockRejectedValueOnce(new Error("disk full"));
    mount(rpc);
    await screen.findByRole("button", { name: "Build box" });

    choose(archiveSelect, "30");
    await screen.findByText(/would archive 3 threads/);
    click("Save retention settings");

    expect((await screen.findByRole("alert")).textContent).toContain("disk full");
    expect(screen.getByRole("region", { name: "Review retention change" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: archiveSelect }) as HTMLSelectElement).value).toBe("30");

    click("Save retention settings");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Review retention change" })).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an immediate save that fails and leaves the saved setting unchanged", async () => {
    const { rpc } = backend({
      state: { policy: { ...off, archiveAfterDays: 30 }, lastRun: null },
      hosts: [row("host_a", "Build box")],
    });
    rpc.configure!.mockRejectedValueOnce(new Error("server stopped"));
    mount(rpc);
    await screen.findByRole("button", { name: "Build box" });

    choose(archiveSelect, "never");

    expect((await screen.findByRole("alert")).textContent).toContain("server stopped");
    expect((screen.getByRole("combobox", { name: archiveSelect }) as HTMLSelectElement).value).toBe("30");
  });

  it("will not save a change it could not preview", async () => {
    const { rpc } = withMachine();
    rpc.preview!.mockRejectedValueOnce(new Error("threads unavailable"));
    mount(rpc);
    await screen.findByRole("button", { name: "Build box" });

    choose(archiveSelect, "30");

    expect((await screen.findByRole("alert")).textContent).toContain("threads unavailable");
    expect(screen.getByRole("button", { name: "Save retention settings" }).hasAttribute("disabled")).toBe(true);
    expect(calls(rpc, "configure")).toHaveLength(0);
  });

  it("ignores a preview that comes back after the review was cancelled", async () => {
    const late = deferred<{ archiveCount: number; clearCount: number }>();
    const { rpc } = withMachine();
    rpc.preview!.mockReturnValueOnce(late.promise);
    mount(rpc);
    await screen.findByRole("button", { name: "Build box" });

    choose(archiveSelect, "30");
    const review = await screen.findByRole("region", { name: "Review retention change" });
    expect(within(review).getByText(/Checking what this would affect/)).toBeTruthy();
    fireEvent.click(within(review).getByRole("button", { name: "Cancel" }));
    await act(async () => late.resolve({ archiveCount: 9, clearCount: 9 }));

    expect(screen.queryByRole("region", { name: "Review retention change" })).toBeNull();
  });

  it("offers a custom saved value next to the presets and describes the last check", async () => {
    const { rpc } = backend({
      state: {
        policy: { archiveAfterDays: 45, clearAfterDays: null, clearStorageOnArchive: false },
        lastRun: { ranAt: Date.now() - 2 * 60 * 60_000, archivedCount: 4, clearedCount: 1, failedCount: 2 },
      },
      hosts: [row("host_a", "Build box")],
    });
    mount(rpc);

    await screen.findByText(/Last checked 2h ago/);
    expect(screen.getByText(/4 archived/)).toBeTruthy();
    expect(screen.getByText(/1 cleared/)).toBeTruthy();
    expect(screen.getByText(/2 failed/)).toBeTruthy();
    const select = screen.getByRole("combobox", { name: archiveSelect }) as HTMLSelectElement;
    expect(select.value).toBe("45");
    expect(within(select).getByRole("option", { name: "After 45 days" })).toBeTruthy();
  });

  it("says the first check is still to come once a policy is on", async () => {
    const { rpc } = backend({
      state: { policy: { ...off, clearAfterDays: 90 }, lastRun: null },
      hosts: [row("host_a", "Build box")],
    });
    mount(rpc);

    await screen.findByText("The first check runs within the hour.");
  });
});

describe("machine detail", () => {
  const detail = (overrides: Partial<HostRow> = {}, reportOverrides: Partial<Report> = {}) =>
    backend({ hosts: [row("host_a", "Build box", { report: report(reportOverrides), ...overrides })] });

  it("breaks storage down by category", async () => {
    const { rpc } = detail(
      {},
      {
        orphanBytes: 512 * MB,
        orphanCount: 2,
        partialCount: 3,
        hiddenThreads: { activeCount: 1, activeBytes: MB, archivedCount: 2, archivedBytes: 2 * MB },
      },
    );
    mount(rpc, "host_a");

    const breakdown = await screen.findByRole("region", { name: "Storage breakdown" });
    expect(within(breakdown).getByText("5.5 GB")).toBeTruthy();
    const table = within(breakdown).getByRole("table");
    expect(within(table).getByRole("row", { name: /Active threads\s*6\s*2 GB/ })).toBeTruthy();
    expect(within(table).getByRole("row", { name: /Archived threads\s*4\s*3 GB/ })).toBeTruthy();
    expect(within(table).getByRole("row", { name: /Orphaned\s*2\s*512 MB/ })).toBeTruthy();
    expect(breakdown.textContent).toContain("Disk space: 120 GB free of 500 GB");
    expect(breakdown.textContent).toContain("Scanned 5m ago");
    expect(breakdown.textContent).toContain("3 folders were too large to measure completely");
    expect(breakdown.textContent).toContain("Includes 3 hidden threads (3 MB)");
    expect(screen.getByRole("heading", { name: "Build box" })).toBeTruthy();
  });

  it("omits what does not apply", async () => {
    const { rpc } = detail({}, { disk: null });
    mount(rpc, "host_a");

    const breakdown = await screen.findByRole("region", { name: "Storage breakdown" });
    expect(breakdown.textContent).not.toContain("Disk space");
    expect(breakdown.textContent).not.toContain("Orphaned");
    expect(breakdown.textContent).not.toContain("hidden threads");
    expect(breakdown.textContent).not.toContain("too large to measure");
  });

  it("goes back to the overview", async () => {
    const { rpc } = detail();
    const slot = mount(rpc, "host_a");
    await screen.findByRole("heading", { name: "Build box" });

    click("All machines");

    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "storage" }]);
  });

  it("reports a machine that is not there", async () => {
    const { rpc } = backend({ hosts: [row("host_a", "Build box")] });
    mount(rpc, "host_zz");

    await screen.findByText("This machine is not available.");
    expect(screen.queryByRole("button", { name: /Scan machine/ })).toBeNull();
  });

  it("invites a first scan, and starts it", async () => {
    const { rpc } = backend({ hosts: [row("host_a", "Build box")] });
    mount(rpc, "host_a");

    await screen.findByText("See what is taking up space");
    expect(screen.getByRole("complementary", { name: "What is thread storage?" })).toBeTruthy();
    click("Scan machine");
    await waitFor(() => expect(calls(rpc, "scanHost")).toEqual([[{ hostId: "host_a" }]]));
  });

  it("shows an unfinished scan and a failed one", async () => {
    const scanning = backend({ hosts: [row("host_a", "Build box", { scan: { state: "scanning", startedAt: 1 } })] });
    mount(scanning.rpc, "host_a");
    await screen.findByText("Scanning this machine");
    expect(screen.getByText(/Scanning in the background/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scanning…" }).hasAttribute("disabled")).toBe(true);
    cleanup();

    const failed = detail({ scan: { state: "failed", failedAt: 1, message: "permission denied" } });
    mount(failed.rpc, "host_a");
    expect((await screen.findByRole("alert")).textContent).toContain("Scan failed: permission denied");
    expect(screen.getByRole("button", { name: "Rescan machine" })).toBeTruthy();
  });

  it("keeps cleanup available while a rescan runs", async () => {
    const { rpc } = detail({ scan: { state: "scanning", startedAt: 1 } }, { orphanCount: 1, orphanBytes: MB });
    mount(rpc, "host_a");

    await screen.findByRole("region", { name: "Storage breakdown" });
    expect(screen.getByText(/Scanning in the background/)).toBeTruthy();
    for (const name of ["Clear archived files", "Delete large files", "Remove orphans"])
      expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(false);
  });

  it("clears archived files only after confirmation", async () => {
    const { rpc } = detail();
    mount(rpc, "host_a");
    await screen.findByRole("region", { name: "Clean up" });

    click("Clear archived files");
    const box = confirmBox();
    expect(box.textContent).toContain("Clear all archived thread files?");
    expect(box.textContent).toContain("3 GB of stored files from 4 archived threads");
    expect(box.textContent).toContain("Pinned and running threads are skipped");
    expect(calls(rpc, "startClearArchivedFiles")).toHaveLength(0);

    fireEvent.click(within(box).getByRole("button", { name: "Clear archived files" }));

    await waitFor(() => expect(calls(rpc, "startClearArchivedFiles")).toEqual([[{ hostId: "host_a" }]]));
    await screen.findByText("Archived-file cleanup started in the background.");
    expect(screen.queryByRole("region", { name: "Confirm cleanup" })).toBeNull();
  });

  it("deletes large files on this machine only after confirmation", async () => {
    const { rpc } = detail();
    mount(rpc, "host_a");
    await screen.findByRole("region", { name: "Clean up" });

    click("Delete large files");
    expect(confirmBox().textContent).toContain("Delete 3 large files (2 GB)?");
    expect(confirmBox().textContent).toContain("10 MB or more from 2 archived threads");
    fireEvent.click(within(confirmBox()).getByRole("button", { name: "Delete large files" }));

    await waitFor(() => expect(calls(rpc, "startClearLargeFiles")).toEqual([[{ hostId: "host_a" }]]));
  });

  it("removes orphaned storage only after confirmation and warns about shared machines", async () => {
    const { rpc } = detail({}, { orphanBytes: 512 * MB, orphanCount: 2 });
    mount(rpc, "host_a");
    await screen.findByRole("region", { name: "Clean up" });

    click("Remove orphans");
    expect(confirmBox().textContent).toContain("Remove 512 MB of orphaned storage?");
    expect(confirmBox().textContent).toContain("another ZCC server");
    expect(calls(rpc, "startRemoveOrphans")).toHaveLength(0);
    fireEvent.click(within(confirmBox()).getByRole("button", { name: "Remove orphans" }));

    await waitFor(() => expect(calls(rpc, "startRemoveOrphans")).toEqual([[{ hostId: "host_a" }]]));
  });

  it("disables a cleanup that has nothing to do", async () => {
    const { rpc } = detail(
      {},
      {
        archivedFiles: { threadCount: 0, bytes: 0 },
        archivedLargeFiles: { threadCount: 0, fileCount: 0, bytes: 0 },
        orphanCount: 0,
      },
    );
    mount(rpc, "host_a");

    const section = await screen.findByRole("region", { name: "Clean up" });
    for (const name of ["Clear archived files", "Delete large files", "Remove orphans"])
      expect(within(section).getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
    expect(section.textContent).toContain("No files of 10 MB or more in archived threads.");
  });

  it("shows a failed cleanup start and keeps the confirmation to retry", async () => {
    const { rpc } = detail({}, { orphanBytes: MB, orphanCount: 1 });
    rpc.startRemoveOrphans!.mockRejectedValueOnce(new Error("Scan the machine first"));
    mount(rpc, "host_a");
    await screen.findByRole("region", { name: "Clean up" });

    click("Remove orphans");
    fireEvent.click(within(confirmBox()).getByRole("button", { name: "Remove orphans" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Scan the machine first");
    expect(confirmBox()).toBeTruthy();
    fireEvent.click(within(confirmBox()).getByRole("button", { name: "Remove orphans" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Confirm cleanup" })).toBeNull());
  });

  it("shows what each background cleanup is doing, and blocks another while one runs", async () => {
    const { rpc } = detail({
      largeFileCleanup: { state: "running", startedAt: 1 },
      archivedFileCleanup: { state: "running", clearedThreads: 2, clearedBytes: 2 * GB },
      maintenance: { state: "running" },
    });
    mount(rpc, "host_a");

    const section = await screen.findByRole("region", { name: "Clean up" });
    expect(section.textContent).toContain("Deleting large files in the background");
    expect(section.textContent).toContain("Cleared 2 GB from 2 threads so far");
    expect(section.textContent).toContain("Removing orphaned storage");
    for (const name of ["Clear archived files", "Delete large files", "Remove orphans"])
      expect(within(section).getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
  });

  it("reports how finished and failed cleanups ended", async () => {
    const done = detail({
      largeFileCleanup: { state: "completed", clearedFiles: 3, clearedBytes: 2 * GB },
      archivedFileCleanup: { state: "completed", clearedThreads: 4, clearedBytes: 3 * GB },
      maintenance: { state: "completed", message: "Removed 2 orphaned folders (512 MB)" },
    });
    mount(done.rpc, "host_a");
    const section = await screen.findByRole("region", { name: "Clean up" });
    expect(section.textContent).toContain("Deleted 3 files (2 GB)");
    expect(section.textContent).toContain("Cleared 3 GB from 4 archived threads");
    expect(section.textContent).toContain("Removed 2 orphaned folders (512 MB)");
    cleanup();

    const failed = detail({
      largeFileCleanup: { state: "failed", message: "host went away" },
      archivedFileCleanup: { state: "failed", message: "disk error", clearedThreads: 1, clearedBytes: MB },
      maintenance: { state: "failed", message: "scan is stale" },
    });
    mount(failed.rpc, "host_a");
    const failedSection = await screen.findByRole("region", { name: "Clean up" });
    expect(failedSection.textContent).toContain("Large-file cleanup failed: host went away");
    expect(failedSection.textContent).toContain("Archived-file cleanup failed: disk error");
    expect(failedSection.textContent).toContain("cleared 1 MB from 1 thread first");
    expect(failedSection.textContent).toContain("Orphan cleanup failed: scan is stale");
    expect(within(failedSection).getAllByRole("alert")).toHaveLength(3);
  });
});

describe("threads using the most storage", () => {
  const withThreads = (threads: HostStorageThread[]) =>
    backend({ hosts: [row("host_a", "Build box", { report: report({ largestThreads: threads }) })] });

  it("says when the scan found no thread files", async () => {
    const { rpc } = withThreads([]);
    mount(rpc, "host_a");

    await screen.findByText("No thread files found in the last scan.");
  });

  it("shows the biggest few with their state, and the rest on request", async () => {
    const threads = [
      thread(1, { pinned: true, hidden: true }),
      thread(2, { archivedAt: 5 }),
      thread(3, { running: true }),
      ...[4, 5, 6, 7].map((n) => thread(n)),
    ];
    const { rpc } = withThreads(threads);
    const slot = mount(rpc, "host_a");

    const section = await screen.findByRole("region", { name: "Threads using the most storage" });
    expect(within(section).getAllByRole("button", { name: /^Clear files:/ })).toHaveLength(5);
    expect(within(section).queryByText("Thread 6")).toBeNull();
    expect(within(section).getByText("hidden")).toBeTruthy();
    expect(within(section).getByText("pinned")).toBeTruthy();
    expect(within(section).getByText("archived")).toBeTruthy();
    expect(within(section).getByText("running")).toBeTruthy();
    expect(within(section).getByText("99 MB")).toBeTruthy();

    fireEvent.click(within(section).getByRole("button", { name: "Show 2 more" }));
    expect(within(section).getByText("Thread 7")).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "Show fewer" }));
    expect(within(section).queryByText("Thread 7")).toBeNull();

    fireEvent.click(within(section).getByRole("button", { name: "Thread 4" }));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_4" }]);
  });

  it("clears one thread's files after confirmation, never a running one", async () => {
    const { rpc } = withThreads([thread(1), thread(2, { running: true })]);
    mount(rpc, "host_a");
    await screen.findByRole("region", { name: "Threads using the most storage" });

    expect(screen.getByRole("button", { name: "Clear files: Thread 2" }).hasAttribute("disabled")).toBe(true);
    click("Clear files: Thread 1");
    expect(confirmBox().textContent).toContain("Clear the files of “Thread 1”?");
    expect(confirmBox().textContent).toContain("Conversation history is kept");
    expect(calls(rpc, "clearThread")).toHaveLength(0);

    fireEvent.click(within(confirmBox()).getByRole("button", { name: "Clear files" }));

    await waitFor(() => expect(calls(rpc, "clearThread")).toEqual([[{ threadId: "thr_1" }]]));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Confirm cleanup" })).toBeNull());
  });

  it("can be cancelled, and only one confirmation is open at a time", async () => {
    const { rpc } = withThreads([thread(1), thread(2)]);
    mount(rpc, "host_a");
    await screen.findByRole("region", { name: "Threads using the most storage" });

    click("Clear files: Thread 1");
    click("Clear files: Thread 2");
    expect(screen.getAllByRole("region", { name: "Confirm cleanup" })).toHaveLength(1);
    expect(confirmBox().textContent).toContain("“Thread 2”");
    fireEvent.click(within(confirmBox()).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("region", { name: "Confirm cleanup" })).toBeNull();
    expect(calls(rpc, "clearThread")).toHaveLength(0);
  });

  it("shows why a thread could not be cleared", async () => {
    const { rpc } = backend(
      { hosts: [row("host_a", "Build box", { report: report({ largestThreads: [thread(1)] }) })] },
      {
        clearThread: () => {
          throw new Error("Stop the thread before clearing its storage");
        },
      },
    );
    mount(rpc, "host_a");
    await screen.findByRole("region", { name: "Threads using the most storage" });

    click("Clear files: Thread 1");
    fireEvent.click(within(confirmBox()).getByRole("button", { name: "Clear files" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Stop the thread before clearing its storage");
  });
});
