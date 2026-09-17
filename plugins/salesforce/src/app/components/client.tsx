import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { callPluginRpc } from "@zana-ai/zcc-plugin-sdk/app";
import type { SalesforceResource } from "../../../lib/workbench-contract.js";

export interface SalesforceUiClient {
  call(method: string, args?: unknown): Promise<unknown>;
}
export function createSalesforceUiClient(
  client: SalesforceUiClient,
): SalesforceUiClient {
  return client;
}
const ClientContext = createContext<SalesforceUiClient | null>(null);
export function SalesforceUiProvider({
  client,
  children,
}: {
  client: SalesforceUiClient;
  children: ReactNode;
}) {
  return (
    <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
  );
}
export function useSalesforceClient(
  pluginId = "salesforce",
): SalesforceUiClient {
  const client = useContext(ClientContext);
  return useMemo(
    () =>
      client ?? {
        call: (method: string, args?: unknown) =>
          callPluginRpc(pluginId, method, args),
      },
    [client, pluginId],
  );
}
export function useSalesforceCall(
  pluginId: string,
  resource: SalesforceResource = {},
  threadId?: string,
) {
  const client = useSalesforceClient(pluginId);
  const { projectId, orgAlias } = resource;
  return useCallback(
    (method: string, args: Record<string, unknown> = {}) =>
      client.call(method, {
        ...args,
        ...(projectId ? { projectId } : {}),
        ...(orgAlias ? { orgAlias } : {}),
        ...(threadId ? { threadId } : {}),
      }),
    [client, projectId, orgAlias, threadId],
  );
}
export function requireResult<T>(value: unknown): T {
  if (
    !value ||
    typeof value !== "object" ||
    ("ok" in value && value.ok === false)
  )
    throw new Error(
      (value as { error?: string })?.error ||
        "Salesforce is unavailable. Check the plugin and connection, then retry.",
    );
  return value as T;
}
