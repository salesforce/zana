import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  useZccNavigate,
  type PluginNavPanelProps,
} from "@zana-ai/zcc-plugin-sdk/app";
import { ago, bytes, duration, isRelaxation, message, plural } from "./src/format.js";
import { LARGE_FILE_MIN_BYTES, LARGE_FILE_NUDGE_MIN_BYTES } from "./src/rules.js";
import type { Policy, Preview, State } from "./src/state-types.js";
import type { HostStorageListResponse } from "./src/storage-types.js";
import styles from "./app.css";

const PANEL = "storage";
const STYLE_TAG_ID = "sr-plugin-styles";
const ARCHIVE_PRESETS = [7, 14, 30, 60, 90, 180, 365];
const CLEAR_PRESETS = [7, 30, 90, 180, 365];
const PREVIEW_COUNT = 5;

function injectStyles(): void {
  if (typeof document === "undefined") return;
  const css = typeof styles === "string" ? styles : "";
  const existing = document.getElementById(STYLE_TAG_ID);
  if (existing instanceof HTMLStyleElement) {
    existing.textContent = css;
    return;
  }
  const tag = document.createElement("style");
  tag.id = STYLE_TAG_ID;
  tag.textContent = css;
  document.head.appendChild(tag);
}
injectStyles();

type HostRow = HostStorageListResponse["hosts"][number];
type Report = NonNullable<HostRow["report"]>;
type LargeFiles = Report["archivedLargeFiles"];
type ThreadRow = Report["largestThreads"][number];

// ---- plugin methods ------------------------------------------------------------------------------

/** The plugin validates what it sends, so the panel only types the answers. */
function useStorageApi() {
  const rpc = useRpc();
  return useMemo(() => {
    const call = <T = unknown,>(method: string, input: unknown = null) =>
      rpc.call(method, input) as Promise<T>;
    return {
      state: () => call<State>("state"),
      hosts: () => call<HostStorageListResponse>("hosts"),
      scanHost: (hostId: string) => call("scanHost", { hostId }),
      scanAll: () => call("scanAll"),
      preview: (policy: Policy) => call<Preview>("preview", policy),
      configure: (policy: Policy) => call<State>("configure", policy),
      clearLargeFiles: (hostId: string | null) => call("startClearLargeFiles", { hostId }),
      clearArchivedFiles: (hostId: string) => call("startClearArchivedFiles", { hostId }),
      removeOrphans: (hostId: string) => call("startRemoveOrphans", { hostId }),
      clearThread: (threadId: string) => call("clearThread", { threadId }),
    };
  }, [rpc]);
}
type Api = ReturnType<typeof useStorageApi>;

// ---- actions with a confirmation -----------------------------------------------------------------

interface Confirmation {
  key: string;
  title: string;
  detail: string;
  action: string;
  /** Prefix of the error shown when starting fails. */
  failure: string;
  /** Shown once it has started. */
  started: string;
  run: () => Promise<unknown>;
}
interface Notice {
  kind: "success" | "error";
  text: string;
}

function useActions(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  /** Run `work`, report its outcome, and reload. Resolves true when it succeeded. */
  const run = useCallback(
    async (failure: string, work: () => Promise<string | void>) => {
      setBusy(true);
      setNotice(null);
      try {
        const done = await work();
        setNotice(done ? { kind: "success", text: done } : null);
        void refresh();
        return true;
      } catch (error) {
        setNotice({ kind: "error", text: `${failure}: ${message(error)}` });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );
  const confirm = useCallback(async () => {
    if (confirmation === null) return;
    const started = await run(confirmation.failure, async () => {
      await confirmation.run();
      return confirmation.started;
    });
    if (started) setConfirmation(null);
  }, [confirmation, run]);

  return { busy, notice, confirmation, setConfirmation, run, confirm };
}
type Actions = ReturnType<typeof useActions>;

// ---- panel ---------------------------------------------------------------------------------------

interface Data {
  state: State;
  hosts: HostRow[];
}

function StoragePanel({ subPath }: PluginNavPanelProps) {
  const api = useStorageApi();
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const stateRevision = useRef(0);
  const refreshRevision = useRef(0);

  const updateState = useCallback((state: State) => {
    stateRevision.current++;
    setData((current) => (current === null ? null : { ...current, state }));
  }, []);
  const refresh = useCallback(async () => {
    const revision = stateRevision.current;
    const request = ++refreshRevision.current;
    try {
      const [state, listed] = await Promise.all([api.state(), api.hosts()]);
      if (request !== refreshRevision.current) return;
      // A policy saved while this was in flight is newer than what came back.
      setData((current) => ({
        state: current !== null && revision !== stateRevision.current ? current.state : state,
        hosts: listed.hosts,
      }));
      setLoadError(null);
    } catch (error) {
      if (request === refreshRevision.current) setLoadError(message(error));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    return () => {
      // Whatever is still in flight belongs to a panel that is gone.
      refreshRevision.current++;
    };
  }, [refresh]);
  useRealtime("changed", () => void refresh());
  useRealtime("policy-changed", () => {
    const revision = stateRevision.current;
    api.state().then(
      (state) => {
        if (revision === stateRevision.current) updateState(state);
      },
      (error: unknown) => setLoadError(message(error)),
    );
  });

  return (
    <div className="sr-panel">
      <div className="sr-page">
        {loadError !== null && (
          <div role="alert" className="sr-notice sr-notice-error">
            <p style={{ margin: "0 0 8px" }}>{loadError}</p>
            <button className="sr-button" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        )}
        {data === null ? (
          loadError === null && (
            <p role="status" className="sr-muted">
              Loading storage…
            </p>
          )
        ) : subPath ? (
          <MachinePage key={subPath} hostId={subPath} hosts={data.hosts} api={api} refresh={refresh} />
        ) : (
          <OverviewPage
            state={data.state}
            hosts={data.hosts}
            api={api}
            refresh={refresh}
            updateState={updateState}
          />
        )}
      </div>
    </div>
  );
}

// ---- shared pieces -------------------------------------------------------------------------------

function Heading({
  title,
  description,
  badge,
  action,
}: {
  title: string;
  description?: string;
  badge?: string;
  action?: ReactNode;
}) {
  return (
    <div className="sr-heading">
      <div>
        <h2>
          {title}
          {badge !== undefined && <span className="sr-pill">{badge}</span>}
        </h2>
        {description !== undefined && <p className="sr-muted sr-small">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function NoticeLine({ notice }: { notice: Notice | null }) {
  if (notice === null) return null;
  return notice.kind === "error" ? (
    <p role="alert" className="sr-notice sr-notice-error">
      {notice.text}
    </p>
  ) : (
    <p role="status" className="sr-notice sr-notice-success">
      {notice.text}
    </p>
  );
}

function ConfirmBox({ actions }: { actions: Actions }) {
  const { confirmation, busy, setConfirmation, confirm } = actions;
  if (confirmation === null) return null;
  return (
    <div role="region" aria-label="Confirm cleanup" className="sr-confirm">
      <div>
        <p className="sr-confirm-title">{confirmation.title}</p>
        <p className="sr-muted sr-small">{confirmation.detail}</p>
      </div>
      <div className="sr-actions">
        <button className="sr-button" disabled={busy} onClick={() => setConfirmation(null)}>
          Cancel
        </button>
        <button className="sr-button sr-button-danger" disabled={busy} onClick={() => void confirm()}>
          {busy ? "Working…" : confirmation.action}
        </button>
      </div>
    </div>
  );
}

function Size({ value }: { value: number }) {
  return value > 0 ? <span className="sr-size">{bytes(value)}</span> : null;
}

function largeFilesConfirmation(api: Api, hostId: string | null, totals: LargeFiles): Confirmation {
  return {
    key: "large-files",
    title: `Delete ${totals.fileCount.toLocaleString("en-US")} large ${totals.fileCount === 1 ? "file" : "files"} (${bytes(totals.bytes)})?`,
    detail: `Delete files of ${bytes(LARGE_FILE_MIN_BYTES)} or more from ${plural(totals.threadCount, "archived thread")}. Smaller files and conversation history will be kept. Pinned and running threads are skipped. This cannot be undone.`,
    action: "Delete large files",
    failure: "Could not start the large-file cleanup",
    started: "Large-file cleanup started in the background.",
    run: () => api.clearLargeFiles(hostId),
  };
}

// ---- overview ------------------------------------------------------------------------------------

function OverviewPage({
  state,
  hosts,
  api,
  refresh,
  updateState,
}: {
  state: State;
  hosts: HostRow[];
  api: Api;
  refresh: () => Promise<void>;
  updateState: (state: State) => void;
}) {
  const navigate = useZccNavigate();
  const actions = useActions(refresh);
  const { busy, confirmation, setConfirmation, run } = actions;

  const large = hosts.reduce<LargeFiles>(
    (totals, host) =>
      host.report === null
        ? totals
        : {
            threadCount: totals.threadCount + host.report.archivedLargeFiles.threadCount,
            fileCount: totals.fileCount + host.report.archivedLargeFiles.fileCount,
            bytes: totals.bytes + host.report.archivedLargeFiles.bytes,
          },
    { threadCount: 0, fileCount: 0, bytes: 0 },
  );
  const deleting = hosts.filter((host) => host.largeFileCleanup.state === "running");
  const suggest = large.bytes >= LARGE_FILE_NUDGE_MIN_BYTES || deleting.length > 0;
  const scannable = hosts.filter((host) => host.scan.state !== "scanning");

  return (
    <>
      <header className="sr-header">
        <h1 className="sr-title">Storage &amp; retention</h1>
        <p className="sr-muted sr-small" style={{ margin: 0 }}>
          See what threads keep on each machine and decide what ZCC may clean up. Nothing is archived or
          cleared unless you turn a policy on or confirm a cleanup.
        </p>
      </header>
      <NoticeLine notice={actions.notice} />
      {suggest && (
        <div className="sr-card sr-card-pad sr-stack">
          <div className="sr-row-top" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <p className="sr-row-name" style={{ margin: 0 }}>
                {large.bytes >= LARGE_FILE_NUDGE_MIN_BYTES
                  ? `Free up ${bytes(large.bytes)} from archived threads`
                  : "Large-file cleanup"}
              </p>
              <p className="sr-muted sr-small" style={{ margin: "2px 0 0" }}>
                {plural(large.fileCount, "file")} of {bytes(LARGE_FILE_MIN_BYTES)} or more sit in the thread
                storage of {plural(large.threadCount, "archived thread")}. Deleting them keeps smaller files and
                conversation history.
              </p>
            </div>
            <button
              className="sr-button"
              disabled={busy || large.fileCount === 0 || deleting.length > 0}
              onClick={() => setConfirmation(largeFilesConfirmation(api, null, large))}
            >
              Delete large files
            </button>
          </div>
          {confirmation?.key === "large-files" && <ConfirmBox actions={actions} />}
          {deleting.map((host) => (
            <p key={host.hostId} role="status" className="sr-muted sr-small" style={{ margin: 0 }}>
              {host.hostName}: Deleting large files…
            </p>
          ))}
        </div>
      )}
      <section aria-label="Machine storage" className="sr-stack">
        <Heading
          title="Machine storage"
          action={
            <button
              className="sr-button"
              disabled={busy || scannable.length === 0}
              onClick={() => void run("Could not start the scan", async () => void (await api.scanAll()))}
            >
              Scan all
            </button>
          }
        />
        <div className="sr-card sr-list">
          {hosts.length === 0 && (
            <div className="sr-row-block" style={{ textAlign: "center" }}>
              <p className="sr-row-name">No machines found</p>
              <p className="sr-muted sr-small">Connect a machine to inspect its storage.</p>
            </div>
          )}
          {hosts.map((host) => (
            <MachineRow
              key={host.hostId}
              host={host}
              busy={busy}
              onOpen={() => navigate.toPluginPanel(PANEL, { subPath: host.hostId })}
              onScan={() =>
                void run("Could not start the scan", async () => void (await api.scanHost(host.hostId)))
              }
            />
          ))}
        </div>
      </section>
      <RetentionSection state={state} api={api} updateState={updateState} />
    </>
  );
}

function threadStorageBytes(report: Report) {
  return report.activeThreadBytes + report.archivedThreadBytes + report.orphanBytes;
}

function MachineRow({
  host,
  busy,
  onOpen,
  onScan,
}: {
  host: HostRow;
  busy: boolean;
  onOpen: () => void;
  onScan: () => void;
}) {
  const report = host.report;
  const scanning = host.scan.state === "scanning";
  const scanState = scanning
    ? "scanning…"
    : host.scan.state === "failed"
      ? "scan failed"
      : report
        ? `scanned ${ago(report.scannedAt)}`
        : "not scanned";
  const usage = report
    ? [
        `${bytes(threadStorageBytes(report))} in ${plural(report.threadsWithStorageCount, "thread")}`,
        ...(report.disk ? [`${bytes(report.disk.freeBytes)} free`] : []),
      ]
    : [];
  return (
    <div className="sr-row">
      <div className="sr-row-main">
        <p className="sr-row-name">
          <button className="sr-link" onClick={onOpen}>
            {host.hostName}
          </button>
        </p>
        <p className="sr-muted sr-small">{scanState}</p>
        {host.scan.state === "failed" && <p className="sr-error">{host.scan.message}</p>}
        {usage.length > 0 && (
          <p className="sr-muted sr-small sr-num">
            {usage.map((item, index) => (
              <span key={item}>
                {item}
                {index < usage.length - 1 && " · "}
              </span>
            ))}
          </p>
        )}
      </div>
      <div className="sr-row-side">
        {report && <span className="sr-num">{bytes(threadStorageBytes(report))}</span>}
        <button
          className="sr-button"
          aria-label={`${report ? "Rescan" : "Scan"} ${host.hostName}`}
          disabled={busy || scanning}
          onClick={onScan}
        >
          {scanning ? "Scanning…" : report ? "Rescan" : "Scan"}
        </button>
      </div>
    </div>
  );
}

// ---- retention -----------------------------------------------------------------------------------

const samePolicy = (a: Policy, b: Policy) =>
  a.archiveAfterDays === b.archiveAfterDays &&
  a.clearAfterDays === b.clearAfterDays &&
  a.clearStorageOnArchive === b.clearStorageOnArchive;

function reviewText(preview: Preview | null, policy: Policy, saved: Policy) {
  if (preview === null) return "Checking what this would affect…";
  const parts = [
    `With these settings the next hourly check would archive ${plural(preview.archiveCount, "thread")} and clear the files of ${plural(preview.clearCount, "archived thread")}.`,
  ];
  if (policy.clearStorageOnArchive && !saved.clearStorageOnArchive)
    parts.push(
      "Files of threads you archive from now on would be cleared about 30 seconds after archiving, once an undo is no longer possible.",
    );
  return parts.join(" ");
}

function RetentionSection({
  state,
  api,
  updateState,
}: {
  state: State;
  api: Api;
  updateState: (state: State) => void;
}) {
  const [review, setReview] = useState<{ policy: Policy; preview: Preview | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const reviewToken = useRef(0);
  const shown = review?.policy ?? state.policy;
  const on = state.policy.archiveAfterDays !== null || state.policy.clearAfterDays !== null;

  async function save(policy: Policy) {
    setSaving(true);
    setError(null);
    try {
      updateState(await api.configure(policy));
      reviewToken.current++;
      setReview(null);
    } catch (failure) {
      setError(`Could not save: ${message(failure)}`);
    } finally {
      setSaving(false);
    }
  }
  function change<K extends keyof Policy>(key: K, value: Policy[K]) {
    if (saving) return;
    const next: Policy = { ...shown, [key]: value };
    const token = ++reviewToken.current;
    setError(null);
    if (samePolicy(next, state.policy)) {
      setReview(null);
      return;
    }
    // Keeping more is safe to save at once; anything that acts on more is previewed first.
    if (isRelaxation(state.policy, next)) {
      setReview(null);
      void save(next);
      return;
    }
    setReview({ policy: next, preview: null });
    api.preview(next).then(
      (preview) => {
        if (token === reviewToken.current) setReview({ policy: next, preview });
      },
      (failure: unknown) => {
        if (token === reviewToken.current) setError(`Could not preview: ${message(failure)}`);
      },
    );
  }
  function cancel() {
    reviewToken.current++;
    setReview(null);
    setError(null);
  }

  return (
    <section aria-label="Automatic retention" className="sr-stack">
      <Heading
        title="Automatic retention"
        description="Archive inactive threads and clear the files of old archives, across all projects. Checked hourly. Everything is off until you turn it on."
        badge={on ? "Checks hourly" : "Off"}
      />
      <p role="note" className="sr-notice">
        <strong>Pinned threads are never archived or cleared.</strong> Pin the threads you want to keep.
        Conversation history and uploaded attachments are never removed by these settings.
      </p>
      <div className="sr-card sr-list">
        <DaysField
          label={archiveLabel}
          description="After this long with no activity."
          presets={ARCHIVE_PRESETS}
          value={shown.archiveAfterDays}
          disabled={saving}
          onChange={(value) => change("archiveAfterDays", value)}
        />
        <DaysField
          label={clearLabel}
          description="After a thread has been archived this long. The thread itself stays."
          presets={CLEAR_PRESETS}
          value={shown.clearAfterDays}
          disabled={saving}
          onChange={(value) => change("clearAfterDays", value)}
        />
        <label className="sr-row">
          <span className="sr-row-main">
            <span className="sr-row-name">{onArchiveLabel}</span>
            <span className="sr-muted sr-small">
              About 30 seconds after archiving, so an undo still works. Conversations and uploaded attachments
              are kept. Pinned threads are skipped.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="sr-switch"
            aria-label={onArchiveLabel}
            checked={shown.clearStorageOnArchive}
            disabled={saving}
            onChange={(event) => change("clearStorageOnArchive", event.target.checked)}
          />
        </label>
        {(state.lastRun !== null || on) && (
          <div className="sr-row">
            <p className="sr-muted sr-small">
              {state.lastRun
                ? `Last checked ${ago(state.lastRun.ranAt)} · ${state.lastRun.archivedCount} archived · ${state.lastRun.clearedCount} cleared${state.lastRun.failedCount ? ` · ${state.lastRun.failedCount} failed` : ""}`
                : "The first check runs within the hour."}
            </p>
          </div>
        )}
      </div>
      {review !== null && (
        <div role="region" aria-label="Review retention change" className="sr-confirm sr-review">
          <p className="sr-confirm-title">Review before saving</p>
          <p className="sr-muted sr-small">{reviewText(review.preview, review.policy, state.policy)}</p>
          <div className="sr-actions">
            <button className="sr-button" disabled={saving} onClick={cancel}>
              Cancel
            </button>
            <button
              className="sr-button"
              disabled={saving || review.preview === null}
              onClick={() => void save(review.policy)}
            >
              {saving ? "Saving…" : "Save retention settings"}
            </button>
          </div>
        </div>
      )}
      {error !== null && (
        <p role="alert" className="sr-error">
          {error}
        </p>
      )}
    </section>
  );
}

const archiveLabel = "Archive inactive threads";
const clearLabel = "Clear files of archived threads";
const onArchiveLabel = "Clear files when a thread is archived";

function DaysField({
  label,
  description,
  presets,
  value,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  presets: number[];
  value: number | null;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  const options =
    value === null || presets.includes(value) ? presets : [...presets, value].sort((a, b) => a - b);
  return (
    <div className="sr-row">
      <div className="sr-row-main">
        <p className="sr-row-name">{label}</p>
        <p className="sr-muted sr-small">{description}</p>
      </div>
      <select
        className="sr-select"
        aria-label={label}
        disabled={disabled}
        value={value === null ? "never" : String(value)}
        onChange={(event) => onChange(event.target.value === "never" ? null : Number(event.target.value))}
      >
        <option value="never">Never</option>
        {options.map((days) => (
          <option key={days} value={String(days)}>
            After {duration(days)}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---- machine detail ------------------------------------------------------------------------------

type Job = { kind: "info" | "success" | "error"; text: string } | null;

function largeFileJob(status: HostRow["largeFileCleanup"]): Job {
  switch (status.state) {
    case "running":
      return { kind: "info", text: "Deleting large files in the background…" };
    case "completed":
      return {
        kind: "success",
        text: `Deleted ${plural(status.clearedFiles, "file")} (${bytes(status.clearedBytes)}).`,
      };
    case "failed":
      return { kind: "error", text: `Large-file cleanup failed: ${status.message}` };
    default:
      return null;
  }
}
function archivedFileJob(status: HostRow["archivedFileCleanup"]): Job {
  switch (status.state) {
    case "running":
      return {
        kind: "info",
        text: `Clearing archived files in the background. Cleared ${bytes(status.clearedBytes)} from ${plural(status.clearedThreads, "thread")} so far.`,
      };
    case "completed":
      return {
        kind: "success",
        text: `Cleared ${bytes(status.clearedBytes)} from ${plural(status.clearedThreads, "archived thread")}.`,
      };
    case "failed":
      return {
        kind: "error",
        text: `Archived-file cleanup failed: ${status.message}${status.clearedThreads > 0 ? ` (cleared ${bytes(status.clearedBytes)} from ${plural(status.clearedThreads, "thread")} first)` : ""}`,
      };
    default:
      return null;
  }
}
function maintenanceJob(status: HostRow["maintenance"]): Job {
  switch (status.state) {
    case "running":
      return { kind: "info", text: "Removing orphaned storage…" };
    case "completed":
      return { kind: "success", text: status.message };
    case "failed":
      return { kind: "error", text: `Orphan cleanup failed: ${status.message}` };
    default:
      return null;
  }
}

function JobLine({ job }: { job: Job }) {
  if (job === null) return null;
  return job.kind === "error" ? (
    <p role="alert" className="sr-error">
      {job.text}
    </p>
  ) : (
    <p role="status" className="sr-muted sr-small">
      {job.text}
    </p>
  );
}

function categories(report: Report) {
  return [
    {
      label: "Active threads",
      count: report.threadsWithStorageCount - report.archivedThreadCount,
      value: report.activeThreadBytes,
    },
    { label: "Archived threads", count: report.archivedThreadCount, value: report.archivedThreadBytes },
    ...(report.orphanCount > 0 || report.orphanBytes > 0
      ? [{ label: "Orphaned", count: report.orphanCount, value: report.orphanBytes }]
      : []),
  ];
}

function MachinePage({
  hostId,
  hosts,
  api,
  refresh,
}: {
  hostId: string;
  hosts: HostRow[];
  api: Api;
  refresh: () => Promise<void>;
}) {
  const navigate = useZccNavigate();
  const actions = useActions(refresh);
  const { busy, confirmation, setConfirmation, run } = actions;
  const [expanded, setExpanded] = useState(false);
  const host = hosts.find((row) => row.hostId === hostId) ?? null;
  const back = (
    <button className="sr-link sr-link-muted" onClick={() => navigate.toPluginPanel(PANEL)}>
      All machines
    </button>
  );

  if (host === null)
    return (
      <header className="sr-header">
        {back}
        <p className="sr-muted">This machine is not available.</p>
      </header>
    );

  const report = host.report;
  const scanning = host.scan.state === "scanning";
  const jobRunning =
    host.largeFileCleanup.state === "running" ||
    host.archivedFileCleanup.state === "running" ||
    host.maintenance.state === "running";
  // Cleanup does not wait for a scan: what a scan finds is merged with what is removed meanwhile.
  const locked = busy || jobRunning;
  const threads = report?.largestThreads ?? [];
  const shownThreads = expanded ? threads : threads.slice(0, PREVIEW_COUNT);
  const hiddenCount = report ? report.hiddenThreads.activeCount + report.hiddenThreads.archivedCount : 0;
  const hiddenBytes = report ? report.hiddenThreads.activeBytes + report.hiddenThreads.archivedBytes : 0;

  const scanNotice = scanning && (
    <p role="status" className="sr-muted sr-small">
      Scanning in the background. Large directories may take a few minutes.
    </p>
  );

  return (
    <>
      <header className="sr-header">
        {back}
        <div className="sr-header-row">
          <div>
            <h1 className="sr-title">{host.hostName}</h1>
            <p className="sr-muted sr-small">Review stored files and free up space on this machine.</p>
          </div>
          <button
            className="sr-button"
            disabled={busy || scanning}
            onClick={() =>
              void run("Could not start the scan", async () => void (await api.scanHost(host.hostId)))
            }
          >
            {scanning ? "Scanning…" : report ? "Rescan machine" : "Scan machine"}
          </button>
        </div>
      </header>
      <NoticeLine notice={actions.notice} />
      <aside aria-label="What is thread storage?" className="sr-info">
        <div>
          <h2>What is thread storage?</h2>
          <p className="sr-muted sr-small">
            A place for an agent to keep things that do not belong in the repository, like plans, reports and
            scratch files. Clearing it removes those files for good. Conversation history and uploaded
            attachments are kept separately.
          </p>
        </div>
      </aside>
      {host.scan.state === "failed" && (
        <p role="alert" className="sr-error">
          Scan failed: {host.scan.message}
        </p>
      )}
      {report === null ? (
        <div className="sr-empty">
          <h2>{scanning ? "Scanning this machine" : "See what is taking up space"}</h2>
          {scanning ? (
            scanNotice
          ) : (
            <p className="sr-muted sr-small">
              Scan this machine to measure thread files and find storage you can clean up. Nothing is removed
              during a scan.
            </p>
          )}
        </div>
      ) : (
        <>
          <section aria-label="Storage breakdown" className="sr-card sr-card-pad">
            <div className="sr-total">
              <p>Thread storage</p>
              <p className="sr-total-value">{bytes(threadStorageBytes(report))}</p>
            </div>
            <table className="sr-table">
              <caption className="sr-sr-only">Storage by category</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Count</th>
                  <th scope="col">Size</th>
                </tr>
              </thead>
              <tbody>
                {categories(report).map((category) => (
                  <tr key={category.label}>
                    <th scope="row">{category.label}</th>
                    <td className="sr-muted">{category.count.toLocaleString("en-US")}</td>
                    <td>{bytes(category.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sr-facts sr-muted sr-small">
              {report.disk && (
                <p className="sr-num">
                  Disk space: {bytes(report.disk.freeBytes)} free of {bytes(report.disk.totalBytes)}
                </p>
              )}
              <p title={new Date(report.scannedAt).toLocaleString()}>Scanned {ago(report.scannedAt)}</p>
              {report.partialCount > 0 && (
                <p>
                  {plural(report.partialCount, "folder")} {report.partialCount === 1 ? "was" : "were"} too large
                  to measure completely, so {report.partialCount === 1 ? "its size is a lower bound" : "their sizes are lower bounds"}.
                </p>
              )}
              {hiddenCount > 0 && (
                <p>
                  Includes {plural(hiddenCount, "hidden thread")} ({bytes(hiddenBytes)}) that{" "}
                  {hiddenCount === 1 ? "does" : "do"} not appear in the thread list.
                </p>
              )}
              {scanNotice}
            </div>
          </section>

          <section aria-label="Clean up" className="sr-stack">
            <Heading
              title="Clean up"
              description="Each cleanup asks for confirmation first and cannot be undone."
            />
            <div className="sr-card sr-list">
              <CleanupRow
                title="All files in archived threads"
                size={report.archivedFiles.bytes}
                description={`Clear stored files of any size from ${plural(report.archivedFiles.threadCount, "archived thread")}. Pinned and running threads are skipped. Conversations and uploaded attachments are kept.`}
                action="Clear archived files"
                disabled={locked || report.archivedFiles.threadCount === 0}
                onAction={() =>
                  setConfirmation({
                    key: "archived-files",
                    title: "Clear all archived thread files?",
                    detail: `Delete ${bytes(report.archivedFiles.bytes)} of stored files from ${plural(report.archivedFiles.threadCount, "archived thread")} on this machine. This includes small files. Conversations and uploaded attachments will be kept. Pinned and running threads are skipped. This cannot be undone.`,
                    action: "Clear archived files",
                    failure: "Could not start the archived-file cleanup",
                    started: "Archived-file cleanup started in the background.",
                    run: () => api.clearArchivedFiles(host.hostId),
                  })
                }
              >
                {confirmation?.key === "archived-files" && <ConfirmBox actions={actions} />}
                <JobLine job={archivedFileJob(host.archivedFileCleanup)} />
              </CleanupRow>
              <CleanupRow
                title="Large files in archived threads"
                size={report.archivedLargeFiles.bytes}
                description={
                  report.archivedLargeFiles.fileCount > 0
                    ? `${plural(report.archivedLargeFiles.fileCount, "file")} of ${bytes(LARGE_FILE_MIN_BYTES)} or more across ${plural(report.archivedLargeFiles.threadCount, "archived thread")}. Smaller files and conversation history are kept.`
                    : `No files of ${bytes(LARGE_FILE_MIN_BYTES)} or more in archived threads.`
                }
                action="Delete large files"
                disabled={locked || report.archivedLargeFiles.fileCount === 0}
                onAction={() =>
                  setConfirmation(largeFilesConfirmation(api, host.hostId, report.archivedLargeFiles))
                }
              >
                {confirmation?.key === "large-files" && <ConfirmBox actions={actions} />}
                <JobLine job={largeFileJob(host.largeFileCleanup)} />
              </CleanupRow>
              <CleanupRow
                title="Orphaned storage"
                size={report.orphanBytes}
                description="Folders in this machine's thread storage that no thread of this ZCC server owns. Only folders older than 10 minutes are removed."
                action="Remove orphans"
                disabled={locked || report.orphanCount === 0}
                onAction={() =>
                  setConfirmation({
                    key: "orphans",
                    title: `Remove ${bytes(report.orphanBytes)} of orphaned storage?`,
                    detail:
                      "Delete folders that no thread knows about. Existing threads and their files are kept. If this machine is also used by another ZCC server, check that those folders are not in use there first. This cannot be undone.",
                    action: "Remove orphans",
                    failure: "Could not start the orphan cleanup",
                    started: "Orphan cleanup started in the background.",
                    run: () => api.removeOrphans(host.hostId),
                  })
                }
              >
                {confirmation?.key === "orphans" && <ConfirmBox actions={actions} />}
                <JobLine job={maintenanceJob(host.maintenance)} />
              </CleanupRow>
            </div>
          </section>

          <section aria-label="Threads using the most storage" className="sr-stack">
            <Heading
              title="Threads using the most storage"
              description="Clear files permanently removes a stopped thread's stored files, including small ones. Conversation history is kept."
            />
            <div className="sr-card sr-list">
              {threads.length === 0 && (
                <p className="sr-muted sr-small" style={{ textAlign: "center", padding: 20, margin: 0 }}>
                  No thread files found in the last scan.
                </p>
              )}
              {shownThreads.map((thread) => (
                <ThreadLine
                  key={thread.threadId}
                  thread={thread}
                  disabled={locked || thread.running}
                  onOpen={() => navigate.toThread(thread.threadId)}
                  onClear={() =>
                    setConfirmation({
                      key: `thread:${thread.threadId}`,
                      title: `Clear the files of “${thread.title}”?`,
                      detail: `Delete ${bytes(thread.sizeBytes)} of stored files, including small ones. Conversation history and uploaded attachments are kept. Conversation history is kept. This cannot be undone.`,
                      action: "Clear files",
                      failure: "Could not clear the thread files",
                      started: `Cleared the files of “${thread.title}”.`,
                      run: () => api.clearThread(thread.threadId),
                    })
                  }
                >
                  {confirmation?.key === `thread:${thread.threadId}` && <ConfirmBox actions={actions} />}
                </ThreadLine>
              ))}
              {threads.length > PREVIEW_COUNT && (
                <div className="sr-row">
                  <button
                    className="sr-link sr-link-muted"
                    aria-expanded={expanded}
                    onClick={() => setExpanded(!expanded)}
                  >
                    {expanded ? "Show fewer" : `Show ${threads.length - PREVIEW_COUNT} more`}
                  </button>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function CleanupRow({
  title,
  size,
  description,
  action,
  disabled,
  onAction,
  children,
}: {
  title: string;
  size: number;
  description: string;
  action: string;
  disabled: boolean;
  onAction: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="sr-row-block">
      <div className="sr-row-top">
        <div className="sr-row-main">
          <p className="sr-row-name">
            {title} <Size value={size} />
          </p>
          <p className="sr-muted sr-small">{description}</p>
        </div>
        <button className="sr-button" disabled={disabled} onClick={onAction}>
          {action}
        </button>
      </div>
      {children}
    </div>
  );
}

function ThreadLine({
  thread,
  disabled,
  onOpen,
  onClear,
  children,
}: {
  thread: ThreadRow;
  disabled: boolean;
  onOpen: () => void;
  onClear: () => void;
  children?: ReactNode;
}) {
  const pills = [
    ...(thread.hidden ? ["hidden"] : []),
    ...(thread.pinned ? ["pinned"] : []),
    ...(thread.running ? ["running"] : thread.archivedAt !== null ? ["archived"] : []),
  ];
  return (
    <div className="sr-row-block">
      <div className="sr-row-top">
        <div className="sr-row-main">
          <p className="sr-row-name">
            <button className="sr-link" title={thread.title} onClick={onOpen}>
              {thread.title}
            </button>{" "}
            {pills.map((pill) => (
              <span key={pill} className="sr-pill">
                {pill}
              </span>
            ))}
          </p>
        </div>
        <div className="sr-row-side">
          <span className="sr-muted sr-small sr-num">{bytes(thread.sizeBytes)}</span>
          <button
            className="sr-button"
            aria-label={`Clear files: ${thread.title}`}
            disabled={disabled}
            onClick={onClear}
          >
            Clear files
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: PANEL,
    title: "Storage & retention",
    icon: "DatabaseBackup",
    path: PANEL,
    component: StoragePanel,
  });
});
