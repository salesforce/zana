import { useMemo, useState, type ComponentType } from "react";
import {
  callPluginRpc,
  useComposer,
  useZccContext,
  type PluginAppBuilder,
  type PluginThreadPanelProps,
} from "@zana-ai/zcc-plugin-sdk/app";
import type {
  SalesforceResource,
  WorkbenchStatus,
} from "./lib/workbench-contract.js";
import {
  SalesforceUiProvider,
  useSalesforceCall,
  type SalesforceUiClient,
} from "./src/app/components/client.js";
import {
  OrgContextPanel,
  RecordPanel,
  ObjectPanel,
  ApexPanel,
  DeploymentsPanel,
  OperationsPanel,
  type SalesforcePanelProps,
} from "./src/app/panels/WorkbenchPanels.js";
import { SoqlExplorerPanel } from "./src/app/soql/SoqlExplorerPanel.js";
import {
  SalesforcePanelFrame,
  OrgSwitcher,
  ErrorState,
  LoadingState,
} from "./src/app/components/ui.js";
import { useResource } from "./src/app/components/use-resource.js";

export type SalesforcePanelKind =
  | "org"
  | "soql"
  | "object"
  | "record"
  | "logs"
  | "deployments"
  | "operations";
const PANELS: Record<
  SalesforcePanelKind,
  {
    title: string;
    icon: string;
    component: ComponentType<SalesforcePanelProps>;
  }
> = {
  org: { title: "Salesforce org", icon: "Cloud", component: OrgContextPanel },
  soql: {
    title: "SOQL Explorer",
    icon: "Database",
    component: (props) => (
      <SoqlExplorerPanel {...props} initialQuery={props.query} />
    ),
  },
  object: {
    title: "Salesforce object",
    icon: "Table2",
    component: ObjectPanel,
  },
  record: {
    title: "Salesforce record",
    icon: "PanelRight",
    component: RecordPanel,
  },
  logs: { title: "Apex & logs", icon: "FlaskConical", component: ApexPanel },
  deployments: {
    title: "Salesforce deployments",
    icon: "Package",
    component: DeploymentsPanel,
  },
  operations: {
    title: "Salesforce operations",
    icon: "Activity",
    component: (props) => (
      <SalesforcePanelFrame title="Operations">
        <OperationsPanel {...props} />
      </SalesforcePanelFrame>
    ),
  },
};

/** Descriptors request navigation; the server authorizes project ids and paths. */
export function parseSalesforceResource(value: unknown): SalesforceResource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  if (raw.version !== undefined && raw.version !== 1) return {};
  const result: Record<string, string | number> = { version: 1 };
  for (const key of [
    "projectId",
    "orgAlias",
    "objectName",
    "recordId",
    "query",
    "logId",
    "operationId",
    "path",
  ]) {
    if (
      typeof raw[key] === "string" &&
      raw[key].length <= (key === "query" ? 20_000 : 1024)
    )
      result[key] = raw[key];
  }
  return result as SalesforceResource;
}

function PanelEntry({
  kind,
  client,
  ...props
}: PluginThreadPanelProps & {
  kind: SalesforcePanelKind;
  client?: SalesforceUiClient;
}) {
  const context = useZccContext();
  const composer = useComposer();
  const resource = parseSalesforceResource(props.params);
  const target = useMemo(
    () =>
      client ?? {
        call: (method: string, input?: unknown) =>
          callPluginRpc("salesforce", method, input),
      },
    [client],
  );
  const add =
    composer.scope.kind === "thread" &&
    composer.scope.threadId === props.threadId
      ? (text: string) => {
          composer.addQuote(text);
          composer.focus();
        }
      : undefined;
  return (
    <SalesforceUiProvider client={target}>
      <PanelContent
        key={JSON.stringify([
          resource,
          props.projectId,
          context.projectId,
          props.threadId,
        ])}
        {...resource}
        kind={kind}
        pluginId="salesforce"
        projectId={
          resource.projectId ??
          props.projectId ??
          context.projectId ??
          undefined
        }
        threadId={props.threadId}
        onAddToPrompt={add}
      />
    </SalesforceUiProvider>
  );
}

function PanelContent(
  props: SalesforcePanelProps & { kind: SalesforcePanelKind },
) {
  const call = useSalesforceCall(
    "salesforce",
    { projectId: props.projectId },
    props.threadId,
  );
  const context = useResource<WorkbenchStatus>(call, "status");
  const [override, setOverride] = useState(props.orgAlias ?? "");
  const alias =
    override || context.data?.selectedAlias || context.data?.defaultOrg;
  const Component = PANELS[props.kind].component;
  return (
    <SalesforcePanelFrame>
      <div className="sf-toolbar">
        <span className="sf-small sf-muted">Panel target</span>
        <OrgSwitcher
          orgs={context.data?.orgs ?? []}
          value={alias ?? ""}
          onChange={setOverride}
        />
        <span className="sf-small sf-muted">{context.data?.projectName}</span>
      </div>
      {context.error && (
        <ErrorState
          message={context.error}
          retry={() => void context.refresh()}
        />
      )}
      {alias ? (
        <Component key={alias} {...props} orgAlias={alias} />
      ) : context.busy ? (
        <LoadingState />
      ) : (
        <ErrorState message="Choose a connected org in Salesforce to use this panel." />
      )}
    </SalesforcePanelFrame>
  );
}

/** Consumer-owned slots avoid private imports and cross-plugin navigation assumptions. */
export function registerSalesforcePanels(
  app: PluginAppBuilder,
  options: { panels?: SalesforcePanelKind[]; client?: SalesforceUiClient } = {},
): void {
  for (const kind of options.panels ??
    (Object.keys(PANELS) as SalesforcePanelKind[])) {
    const panel = PANELS[kind];
    app.slots.commandPaletteAction({
      id: `sf-open-${kind}`,
      title: `Open ${panel.title} beside agent`,
      isAvailable: (context) => Boolean(context.threadId),
      run: (context) => {
        context.openPanel({
          actionId: `sf-${kind}`,
          params: {
            version: 1,
            ...(context.projectId ? { projectId: context.projectId } : {}),
          },
        });
      },
    });
    app.slots.threadPanelAction({
      id: `sf-${kind}`,
      title: panel.title,
      icon: panel.icon,
      layout: "flush",
      scopes: ["thread", "agent-session"],
      component: (props) => (
        <PanelEntry {...props} kind={kind} client={options.client} />
      ),
    });
  }
  if ((options.panels ?? Object.keys(PANELS)).includes("soql"))
    app.slots.messageAction({
      id: "sf-inspect-query",
      title: "Inspect in SOQL",
      icon: "Database",
      run: (context) => {
        const query = context.selectedText?.trim().slice(0, 20_000);
        context.openPanel({
          actionId: "sf-soql",
          params: { version: 1, ...(query ? { query } : {}) },
        });
      },
    });
}

export {
  OrgContextPanel,
  RecordPanel,
  ObjectPanel,
  ApexPanel,
  DeploymentsPanel,
  OperationsPanel,
};
export type { SalesforcePanelProps };
