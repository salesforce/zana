import { OrgPicker } from './OrgPicker.js';
import { SalesforcePanelFrame } from './components/ui.js';

export function SalesforceOrgsPanel(props: { pluginId: string; subPath?: string }) {
  return <SalesforcePanelFrame title="Salesforce orgs"><div className="sf-scroll sf-content" data-testid="salesforce-orgs-panel"><h2>Your Salesforce connections.</h2><p className="sf-muted">Inspect connected orgs and manage the shared fallback. Project targets are selected inside each project.</p><OrgPicker pluginId={props.pluginId} /></div></SalesforcePanelFrame>;
}
