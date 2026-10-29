import { useZccContext, useZccNavigate, type ZccNavigate } from "@zana-ai/zcc-plugin-sdk/app";
import { ArrowUpRight } from "./components/icons.js";
import type { WorkbenchView } from '../../lib/workbench-contract.js';
import { rememberProjectView } from './project-view.js';

/**
 * Takes the person from the Agentforce Studio to the general Salesforce tools (Overview, Data,
 * Apex & logs, Deployments) in the main window. While the Studio is detached, the main window's
 * Salesforce tab is the tools surface (`SalesforceStudioDetachedCard`). Request the
 * main tab explicitly so its normal detached-window redirect cannot focus Studio again.
 * The requested section is remembered before navigation: new mounts read it and an
 * already-mounted main tab receives it through the browser storage event.
 */
export function openSalesforceTools(navigate: Pick<ZccNavigate, "toProject">, projectId: string, view?: WorkbenchView): void {
  if (view) rememberProjectView(projectId, view);
  navigate.toProject(projectId, { tabId: 'salesforce', inMainWindow: true });
}

/** "Salesforce ↗" for the Studio header. Only the Studio window needs it: the main-window tab has the tools beside it. */
export function SalesforceToolsLink(props: { projectId: string; className?: string }) {
  const navigate = useZccNavigate();
  const context = useZccContext();
  if (context.surface !== "plugin-view") return null;
  return (
    <button
      className={props.className ?? "sf-btn quiet"}
      type="button"
      title="Open Data, Apex, Deployments and Overview in the main window"
      onClick={() => openSalesforceTools(navigate, props.projectId)}
    >
      Salesforce <ArrowUpRight />
    </button>
  );
}
