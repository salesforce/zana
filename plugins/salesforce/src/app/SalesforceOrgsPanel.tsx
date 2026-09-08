import { OrgPicker } from './OrgPicker.js';

export function SalesforceOrgsPanel(props: { pluginId: string; subPath: string }) {
  return (
    <div className="sf-orgs-panel" data-testid="salesforce-orgs-panel" style={{ padding: 24, height: '100%', boxSizing: 'border-box' }}>
      <h2 style={{ marginTop: 0 }}>Salesforce</h2>
      <p style={{ color: 'var(--text-muted)' }}>CLI-connected orgs. Selecting one sets the shared default org for SOQL, Apex, LWC, and Agentforce.</p>
      <OrgPicker pluginId={props.pluginId} />
    </div>
  );
}
