import type { Locator } from '@playwright/test';

/** Project tools moved into the Salesforce-style launcher; editor tabs stay separate. */
export async function selectSalesforceSection(workbench: Locator, section: 'overview' | 'data' | 'apex' | 'deployments' | 'agentforce') {
  await workbench.getByRole('button', { name: 'Open Salesforce tools', exact: true }).click();
  await workbench.getByRole('dialog', { name: 'Salesforce tools', exact: true }).locator(`[data-section="${section}"]`).click();
}
