import { join } from 'node:path';
import { lstatSync } from 'node:fs';
import { isDxProject, readJsonObject, resolveUnderRoot } from './dx-project.js';
import type { SalesforceProjectContext } from './project-context.js';
import { parseOrgLoginInput } from './org-login.js';
import type { SalesforceDeps } from './types.js';

/** The caller resolves this context from the host's registered project list. */
export async function connectDxProject(
  context: SalesforceProjectContext,
  alias: string,
  deps: Pick<SalesforceDeps, 'execSf' | 'exists' | 'realpath'>,
  connectedAliases: string[],
): Promise<void> {
  const root = context.settings.projectRoot;
  if (!context.projectId || !isDxProject(root, deps.exists)) {
    throw Error('Choose a registered Salesforce DX project.');
  }
  if (!alias || !parseOrgLoginInput({ alias }).ok || !connectedAliases.includes(alias)) {
    throw Error('Choose an org from the connected org list.');
  }
  for (const path of ['sfdx-project.json', '.sf', '.sf/config.json', '.sfdx', '.sfdx/sfdx-config.json']) {
    // existsSync follows links; a dangling config symlink must also be rejected.
    const present = deps.exists(join(root, path)) || lstatSync(join(root, path), { throwIfNoEntry: false });
    if (present && !resolveUnderRoot(root, path, deps.realpath)) {
      throw Error('Salesforce project configuration must stay inside the project folder.');
    }
  }
  const result = await deps.execSf(['config', 'set', `target-org=${alias}`, '--json'], {
    cwd: root, timeoutMs: 30_000,
  });
  if (result.code !== 0 || readJsonObject(result.stdout)?.status !== 0) {
    throw Error('Could not set the project’s default org. Check Salesforce CLI and folder permissions, then retry.');
  }
}
