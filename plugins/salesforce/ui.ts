/** Browser-only public UI. The host supplies React; no server or credential dependencies. */
export {
  SalesforcePanelFrame,
  OrgBadge,
  OrgSwitcher,
  RecordInspector,
  ObjectInspector,
  RunSummary,
  EmptyState,
  ErrorState,
  LoadingState,
} from "./src/app/components/ui.js";
export { SALESFORCE_STYLES } from "./src/app/components/styles.js";
export {
  createSalesforceUiClient,
  SalesforceUiProvider,
} from "./src/app/components/client.js";
export type { SalesforceUiClient } from "./src/app/components/client.js";
export { SoqlResultsGrid as QueryResults } from "./src/app/soql/SoqlResultsGrid.js";
export type {
  SalesforceResource,
  SalesforceOperation,
} from "./lib/workbench-contract.js";
