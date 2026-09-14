import { useEffect, useRef, useState } from "react";
import {
  DESKTOP_BROWSER_IMPORT_FAILURE_COPY,
  isRetryableDesktopBrowserImportReason,
  type DesktopBrowserApi,
  type DesktopBrowserImportOutcome,
  type DesktopBrowserImportSource,
} from "@zana-ai/zcc-desktop-contract";
import { Modal } from "@/components/Modal";
import { BrowserSourceIcon } from "./BrowserSourceIcon";
import {
  canCloseDialog,
  failedDialogStep,
  formatCookieCount,
  initialDialogStep,
  preferredSourceProfileDirectory,
  refreshedDialogStep,
  type BrowserImportDialogStep,
} from "./browser-import-wizard";

export interface BrowserImportDialogProps {
  source: DesktopBrowserImportSource;
  desktopBrowser: DesktopBrowserApi;
  onClose: () => void;
  onImported: (
    source: DesktopBrowserImportSource,
    profileName: string,
    outcome: DesktopBrowserImportOutcome & { ok: true },
  ) => void;
}

export function BrowserImportDialog({
  source: initialSource,
  desktopBrowser,
  onClose,
  onImported,
}: BrowserImportDialogProps) {
  const [source, setSource] = useState(initialSource);
  const [step, setStep] = useState<BrowserImportDialogStep>(() =>
    initialDialogStep(initialSource),
  );
  const [sourceProfileDirectory, setSourceProfileDirectory] = useState<
    string | null
  >(() => preferredSourceProfileDirectory(null, initialSource));
  const [intoAutomation, setIntoAutomation] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const selectedProfile = source.profiles.find(
    (profile) => profile.directory === sourceProfileDirectory,
  );

  const runImport = () => {
    if (
      sourceProfileDirectory === null ||
      selectedProfile === undefined ||
      !desktopBrowser.importCookies
    ) {
      setStep({ step: "blocked", reason: "unknownSourceProfile" });
      return;
    }
    if (
      intoAutomation &&
      !window.confirm(
        "Copy cookies into agent-controlled tabs as well? This is a second confirmation — personal tabs already receive the import by default.",
      )
    ) {
      return;
    }
    const profileName = selectedProfile.name;
    setStep({ step: "importing" });
    desktopBrowser
      .importCookies({
        sourceId: source.id,
        sourceProfileDirectory,
        ...(intoAutomation ? { intoAutomation: true } : {}),
      })
      .then((outcome) => {
        if (!mounted.current) return;
        const parsed = outcome as DesktopBrowserImportOutcome;
        if (parsed.ok) {
          onImported(source, profileName, parsed);
          onClose();
          return;
        }
        setStep(failedDialogStep(parsed.reason));
      })
      .catch(() => {
        if (mounted.current) setStep({ step: "blocked", reason: "readFailed" });
      });
  };

  const recheck = () => {
    if (!desktopBrowser.listImportSources) return;
    const previous = step;
    setStep({ step: "checking" });
    desktopBrowser
      .listImportSources()
      .then((result) => {
        if (!mounted.current) return;
        const payload = result as { sources?: DesktopBrowserImportSource[] };
        const refreshed = payload.sources?.find(
          (candidate) => candidate.id === source.id,
        );
        if (refreshed) {
          setSource(refreshed);
          setSourceProfileDirectory((current) =>
            preferredSourceProfileDirectory(current, refreshed),
          );
        }
        setStep(refreshedDialogStep(refreshed, previous));
      })
      .catch(() => {
        if (mounted.current) setStep({ step: "blocked", reason: "readFailed" });
      });
  };

  const closable = canCloseDialog(step);
  const heading =
    step.step === "fullDiskAccess"
      ? `Allow Full Disk Access for ${source.name}`
      : step.step === "checking"
        ? `Checking ${source.name}…`
        : step.step === "importing"
          ? `Importing from ${source.name}…`
          : step.step === "blocked"
            ? `Can't import from ${source.name}`
            : `Import from ${source.name}`;

  return (
    <Modal
      title={heading}
      onClose={closable ? onClose : () => undefined}
      hideClose={!closable}
      closeOnBackdrop={closable}
      header={
        <div className="modal-header">
          <h3>
            <BrowserSourceIcon source={source} /> {heading}
          </h3>
        </div>
      }
      footer={
        step.step === "fullDiskAccess" ? (
          <>
            <button type="button" className="settings-btn" onClick={onClose}>
              Cancel
            </button>
            {desktopBrowser.openFullDiskAccessSettings ? (
              <button
                type="button"
                className="settings-btn"
                onClick={() => void desktopBrowser.openFullDiskAccessSettings?.()}
              >
                Open System Settings
              </button>
            ) : null}
            <button type="button" className="settings-btn settings-btn--primary" onClick={recheck}>
              I've turned it on
            </button>
          </>
        ) : step.step === "blocked" ? (
          <>
            <button type="button" className="settings-btn" onClick={onClose}>
              Close
            </button>
            {isRetryableDesktopBrowserImportReason(step.reason) ? (
              <button type="button" className="settings-btn settings-btn--primary" onClick={recheck}>
                {step.reason === "browserRunning" ? "I've quit it" : "Try again"}
              </button>
            ) : null}
          </>
        ) : step.step === "configure" ? (
          <>
            <button type="button" className="settings-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              onClick={runImport}
              disabled={sourceProfileDirectory === null}
            >
              {selectedProfile?.cookieCount !== undefined
                ? `Import ${formatCookieCount(selectedProfile.cookieCount)}`
                : "Import"}
            </button>
          </>
        ) : null
      }
    >
      {step.step === "fullDiskAccess" ? (
        <>
          <p>
            {source.name} keeps its cookies in a protected folder. Turn on Full Disk
            Access for Zana in System Settings → Privacy &amp; Security, then come
            back. You can turn it off again after the import.
          </p>
          {step.checked ? (
            <p>
              Full Disk Access is still off. macOS may require quitting and
              reopening Zana before the grant applies.
            </p>
          ) : null}
        </>
      ) : step.step === "checking" ? (
        <p>This only takes a moment.</p>
      ) : step.step === "importing" ? (
        <p>Reading and decrypting cookies. macOS may ask for Keychain access.</p>
      ) : step.step === "blocked" ? (
        <p>{DESKTOP_BROWSER_IMPORT_FAILURE_COPY[step.reason]}</p>
      ) : (
        <>
          <p>Which profile's cookies should be copied into the in-app browser?</p>
          <div role="radiogroup" aria-label="Source profile" className="browser-import-profiles">
            {source.profiles.map((profile) => {
              const selected = profile.directory === sourceProfileDirectory;
              return (
                <button
                  key={profile.directory}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={selected ? "browser-import-profile is-selected" : "browser-import-profile"}
                  onClick={() => setSourceProfileDirectory(profile.directory)}
                >
                  <span>
                    <span>{profile.name}</span>
                    {profile.cookieCount !== undefined ? (
                      <span className="settings-help">{formatCookieCount(profile.cookieCount)}</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
          <label className="browser-import-automation">
            <input
              type="checkbox"
              checked={intoAutomation}
              onChange={(event) => setIntoAutomation(event.target.checked)}
            />
            Also import into agent automation tabs (requires a second confirmation)
          </label>
          <p className="settings-help">
            {source.name} must stay closed during the import. macOS may ask for
            Keychain access to its encryption key; choose Allow. Cookie values never
            leave the desktop main process.
          </p>
        </>
      )}
    </Modal>
  );
}
