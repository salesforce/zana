import { useEffect } from "react";
import type { PluginDetachedTabProps } from "@zana-ai/zcc-plugin-sdk/app";
import { STUDIO_RPC, type StudioViewState } from "../../lib/studio-contract.js";
import type { WorkbenchStatus } from "../../lib/workbench-contract.js";
import { AppWindow } from "./components/icons.js";
import { useSalesforceCall } from "./components/client.js";
import { SALESFORCE_STYLES } from "./components/styles.js";
import { useResource } from "./components/use-resource.js";
import { OrgBadge } from "./components/ui.js";
import { CONTEXT_CHANGED_EVENT, useContextChangeRelay } from "./context-sync.js";

/** How often the card re-reads what the Studio window shares (an in-memory read on the server). */
export const DETACHED_VIEW_REFRESH_MS = 5000;

const ENGINE_LABELS: Record<NonNullable<StudioViewState["lastRun"]>["engine"], string> = {
  rehearse: "Rehearse",
  simulate: "Simulate",
  live: "Live",
};

const fileName = (path: string) => path.split("/").pop() || path;

/**
 * Stands in for the Salesforce tab while the Studio runs in its own window.
 * It only reads state, so one window owns the editor, preview and leases.
 */
export function SalesforceStudioDetachedCard(props: PluginDetachedTabProps) {
  useContextChangeRelay();
  const call = useSalesforceCall(props.pluginId, { projectId: props.projectId });
  const status = useResource<WorkbenchStatus>(call, "status");
  const shared = useResource<{ shared?: boolean; state?: StudioViewState | null }>(call, STUDIO_RPC.viewGet);
  const refreshStatus = status.refresh;
  const refreshShared = shared.refresh;

  useEffect(() => {
    const timer = setInterval(() => void refreshShared(), DETACHED_VIEW_REFRESH_MS);
    const changed = (event: Event) => {
      const projectId = (event as CustomEvent<{ projectId?: string | null }>).detail?.projectId;
      if (projectId && projectId !== props.projectId) return;
      void refreshStatus();
    };
    window.addEventListener(CONTEXT_CHANGED_EVENT, changed);
    return () => {
      clearInterval(timer);
      window.removeEventListener(CONTEXT_CHANGED_EVENT, changed);
    };
  }, [props.projectId, refreshShared, refreshStatus]);

  const alias = status.data?.selectedAlias || status.data?.defaultOrg || "";
  const org = status.data?.orgs?.find((row) => row.alias === alias || row.username === alias) ?? null;
  const view = shared.data?.shared ? shared.data.state ?? null : null;
  const problems = view?.diagnostics.length ?? 0;

  return (
    <section className="sf-surface sf-detached-surface" data-testid="salesforce-studio-detached">
      <style>{SALESFORCE_STYLES}</style>
      <div className="sf-detached">
        <div className="sf-detached-head">
          <span className="sf-detached-icon"><AppWindow /></span>
          <div>
            <strong>Salesforce Studio is open in another window</strong>
            <div className="sf-muted sf-small">This tab shows its state. You edit in the Studio window.</div>
          </div>
        </div>
        <dl className="sf-detached-rows">
          <div className="sf-detached-row">
            <dt>Org</dt>
            <dd>
              {org ? <OrgBadge org={org} /> : alias || <span className="sf-muted">No org selected</span>}
              {alias && status.data?.targetSource && (
                <span className="sf-muted"> · {status.data.targetSource === "project" ? "Project target" : "Default target"}</span>
              )}
            </dd>
          </div>
          <div className="sf-detached-row">
            <dt>Agent</dt>
            <dd>
              {view?.path ? (
                <>
                  <strong title={view.path}>{fileName(view.path)}</strong>
                  {view.dirty && <span className="sf-badge sf-detached-tag">Unsaved edits</span>}
                  {problems > 0 && <span className="sf-badge sf-detached-tag sf-error">{problems === 1 ? "1 problem" : `${problems} problems`}</span>}
                </>
              ) : (
                <span className="sf-muted">Shows here while you edit an agent in the Studio window.</span>
              )}
            </dd>
          </div>
          {view?.lastRun && (
            <div className="sf-detached-row">
              <dt>Preview</dt>
              <dd>
                {ENGINE_LABELS[view.lastRun.engine]} run
                {view.lastRun.turn !== undefined && <span className="sf-muted"> · turn {view.lastRun.turn}</span>}
              </dd>
            </div>
          )}
        </dl>
        <div className="sf-detached-foot">
          <button className="sf-btn primary" type="button" onClick={props.focusWindow}>Focus Studio window</button>
          <button className="sf-btn" type="button" onClick={props.bringBack}>Bring back here</button>
        </div>
      </div>
      <p className="sf-detached-note sf-muted sf-small">
        Closing the Studio window brings Salesforce back to this tab. Unsaved agent edits stay as drafts.
      </p>
    </section>
  );
}
