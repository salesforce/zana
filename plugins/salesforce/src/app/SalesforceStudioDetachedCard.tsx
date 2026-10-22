import { useEffect } from "react";
import type { PluginDetachedTabProps } from "@zana-ai/zcc-plugin-sdk/app";
import { STUDIO_RPC, countProblems, type StudioViewState } from "../../lib/studio-contract.js";
import { AppWindow } from "./components/icons.js";
import { useSalesforceCall } from "./components/client.js";
import { useResource } from "./components/use-resource.js";
import { SalesforceProjectTab } from "./SalesforceProjectTab.js";

/** How often the card re-reads what the Studio window shares (an in-memory read on the server). */
export const DETACHED_VIEW_REFRESH_MS = 5000;

const fileName = (path: string) => path.split("/").pop() || path;

/**
 * Stands in for the Salesforce tab while the Agentforce Studio runs in its own window.
 * The general tools (Overview, Data, Apex & logs, Deployments) keep working here; the notice
 * shows what the Studio has open and hands off to its window. Only the Studio window edits.
 */
export function SalesforceStudioDetachedCard(props: PluginDetachedTabProps) {
  const call = useSalesforceCall(props.pluginId, { projectId: props.projectId });
  const shared = useResource<{ shared?: boolean; state?: StudioViewState | null }>(call, STUDIO_RPC.viewGet);
  const refreshShared = shared.refresh;

  useEffect(() => {
    const timer = setInterval(() => void refreshShared(), DETACHED_VIEW_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshShared]);

  const view = shared.data?.shared ? shared.data.state ?? null : null;
  const problems = view ? countProblems(view.diagnostics) : 0;

  const notice = (
    <div className="sf-notice" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }} role="status" data-testid="salesforce-studio-detached">
      <AppWindow aria-hidden="true" />
      <span className="sf-grow">
        <strong>Agentforce Studio is open in its own window</strong>
        {view?.path && (
          <span className="sf-muted">
            {" · "}
            <span title={view.path}>{fileName(view.path)}</span>
            {view.dirty && <span className="sf-badge sf-detached-tag">Unsaved edits</span>}
            {problems > 0 && <span className="sf-badge sf-detached-tag sf-error">{problems === 1 ? "1 problem" : `${problems} problems`}</span>}
          </span>
        )}
      </span>
      <button className="sf-btn primary" type="button" onClick={props.focusWindow}>Show window</button>
      <button className="sf-btn" type="button" onClick={props.bringBack}>Bring back here</button>
    </div>
  );
  return <SalesforceProjectTab pluginId={props.pluginId} projectId={props.projectId} detached={{ notice, focusWindow: props.focusWindow }} />;
}
