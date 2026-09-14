import { useCallback, useEffect, useState } from "react";
import {
  DESKTOP_BROWSER_IMPORT_FAILURE_COPY,
  type DesktopBrowserApi,
  type DesktopBrowserImportOutcome,
  type DesktopBrowserImportSource,
} from "@zana-ai/zcc-desktop-contract";
import { Section } from "@/components/settings/FormFields";
import { useUi } from "@/store";
import { getDesktopBrowserApi } from "@/lib/desktop-browser";
import { BrowserImportDialog } from "./BrowserImportDialog";
import { BrowserSourceIcon } from "./BrowserSourceIcon";
import {
  BROWSER_IMPORT_RECORDS_STORAGE_KEY,
  formatCookieCount,
  formatRelativeTime,
  listedSources,
  needsProfileChoice,
  presentSourceRow,
  readBrowserImportRecords,
  recordFromOutcome,
  sourceAfterFailure,
  type BrowserImportRecords,
  type SourceRowTone,
} from "./browser-import-wizard";

type SourcesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sources: DesktopBrowserImportSource[] };

function localStorageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

interface BrowserRowProps {
  source: DesktopBrowserImportSource;
  record: BrowserImportRecords[DesktopBrowserImportSource["id"]];
  now: number;
  pending: boolean;
  onImport: () => void;
  onRecheck: () => void;
}

function BrowserRow({
  source,
  record,
  now,
  pending,
  onImport,
  onRecheck,
}: BrowserRowProps) {
  const presentation = presentSourceRow(source, record);
  const actionable = presentation.action !== "none";
  return (
    <div className="browser-import-row" data-testid={`browser-import-${source.id}`}>
      <BrowserSourceIcon source={source} />
      <div className="browser-import-row-copy">
        <div className="browser-import-row-title">
          <span>{source.name}</span>
          {record ? (
            <span className="settings-help">
              imported {formatRelativeTime({ timestamp: record.at, now })}
            </span>
          ) : null}
        </div>
        <div className="settings-help" data-tone={presentation.tone as SourceRowTone}>
          {presentation.status}
          {presentation.details.map((detail) => (
            <span key={detail}> · {detail}</span>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="settings-btn"
        disabled={!actionable || pending}
        onClick={presentation.action === "recheck" ? onRecheck : onImport}
      >
        {presentation.actionLabel}
      </button>
    </div>
  );
}

export interface BrowserSettingsSectionContentProps {
  desktopBrowser: DesktopBrowserApi | null;
}

export function BrowserSettingsSectionContent({
  desktopBrowser,
}: BrowserSettingsSectionContentProps) {
  const pushToast = useUi((s) => s.pushToast);
  const supported = desktopBrowser?.listImportSources !== undefined;
  const [state, setState] = useState<SourcesState>({ status: "loading" });
  const [records, setRecords] = useState<BrowserImportRecords>(() =>
    readBrowserImportRecords(localStorageOrNull()),
  );
  const [dialogSource, setDialogSource] =
    useState<DesktopBrowserImportSource | null>(null);
  const [pendingSourceIds, setPendingSourceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const anyPending = pendingSourceIds.size > 0;

  const refresh = useCallback(() => {
    if (!desktopBrowser?.listImportSources) return;
    setState((current) =>
      current.status === "ready" ? current : { status: "loading" },
    );
    desktopBrowser
      .listImportSources()
      .then((result) => {
        const payload = result as { sources?: DesktopBrowserImportSource[] };
        setState({ status: "ready", sources: payload.sources ?? [] });
      })
      .catch((error: unknown) =>
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not check installed browsers.",
        }),
      );
  }, [desktopBrowser]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const recordImport = (
    source: DesktopBrowserImportSource,
    profileName: string,
    outcome: DesktopBrowserImportOutcome & { ok: true },
  ) => {
    const record = recordFromOutcome(outcome, profileName, Date.now());
    setRecords((current) => {
      const next: BrowserImportRecords = { ...current, [source.id]: record };
      try {
        localStorageOrNull()?.setItem(
          BROWSER_IMPORT_RECORDS_STORAGE_KEY,
          JSON.stringify(next),
        );
      } catch {
        return next;
      }
      return next;
    });
    pushToast(
      outcome.imported > 0
        ? `Imported ${formatCookieCount(outcome.imported)} from ${source.name}`
        : `No cookies were imported from ${source.name}`,
    );
  };

  const importDirectly = (source: DesktopBrowserImportSource) => {
    const profile = source.profiles[0];
    if (!profile || !desktopBrowser?.importCookies) {
      setDialogSource(source);
      return;
    }
    setPendingSourceIds((current) => new Set(current).add(source.id));
    desktopBrowser
      .importCookies({
        sourceId: source.id,
        sourceProfileDirectory: profile.directory,
      })
      .then((outcome) => {
        const parsed = outcome as DesktopBrowserImportOutcome;
        if (parsed.ok) {
          recordImport(source, profile.name, parsed);
          return;
        }
        const blocked = sourceAfterFailure(source, parsed.reason);
        if (blocked) setDialogSource(blocked);
        else
          pushToast(
            `${source.name}: ${DESKTOP_BROWSER_IMPORT_FAILURE_COPY[parsed.reason]}`,
            "error",
          );
      })
      .catch(() => {
        pushToast(`Could not read ${source.name}'s cookies.`, "error");
      })
      .finally(() => {
        setPendingSourceIds((current) => {
          const next = new Set(current);
          next.delete(source.id);
          return next;
        });
        refresh();
      });
  };

  const listed = state.status === "ready" ? listedSources(state.sources) : [];
  const now = Date.now();

  return (
    <>
      <Section
        title="Browsers"
        anchorId="browsers"
        help="Bring signed-in sessions from a browser on this machine into the in-app browser, so previews and agent tabs open already logged in. Cookie values never leave the desktop main process."
      >
        {supported ? (
          <button
            type="button"
            className="settings-btn"
            onClick={refresh}
            disabled={state.status === "loading"}
          >
            Refresh
          </button>
        ) : null}
        {!supported ? (
          <p className="settings-help">Only available in the desktop app.</p>
        ) : state.status === "loading" ? (
          <p className="settings-help">Loading…</p>
        ) : state.status === "error" ? (
          <p className="settings-help">{state.message}</p>
        ) : listed.length === 0 ? (
          <p className="settings-help">No supported browsers were found on this machine.</p>
        ) : (
          <div className="browser-import-list">
            {listed.map((source) => (
              <BrowserRow
                key={source.id}
                source={source}
                record={records[source.id]}
                now={now}
                pending={anyPending}
                onRecheck={refresh}
                onImport={() => {
                  if (needsProfileChoice(source)) setDialogSource(source);
                  else if (source.unavailable === undefined) importDirectly(source);
                  else setDialogSource(source);
                }}
              />
            ))}
          </div>
        )}
      </Section>
      {dialogSource && desktopBrowser ? (
        <BrowserImportDialog
          key={`${dialogSource.id}:${dialogSource.unavailable ?? "ready"}`}
          source={dialogSource}
          desktopBrowser={desktopBrowser}
          onClose={() => {
            setDialogSource(null);
            refresh();
          }}
          onImported={recordImport}
        />
      ) : null}
    </>
  );
}

export function BrowserSettingsSection() {
  const [desktopBrowser] = useState(getDesktopBrowserApi);
  return <BrowserSettingsSectionContent desktopBrowser={desktopBrowser} />;
}
