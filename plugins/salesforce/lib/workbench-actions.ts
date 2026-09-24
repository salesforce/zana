/** Public semantic operations. The renderer RPC table is deliberately not an agent API. */
export const WORKBENCH_ACTIONS = {
  'context.status': ['status', 'local', 'Project, target org and DX status'],
  'context.select': ['context.select', 'local', 'Select a connected org for this project: selectedAlias'],
  'org.list': ['orgs', 'local', 'List connected orgs (no credentials)'],
  'org.login.start': ['orgs.login.start', 'local', 'Start browser sign-in: instance (production/sandbox/custom), alias, instanceUrl'],
  'org.login.status': ['orgs.login.status', 'local', 'Poll browser sign-in: jobId'],
  'project.create': ['project.generate', 'local', 'Create a DX child project inside this registered project: name'],
  'query.execute': ['query.execute', 'self', 'Run bounded SOQL and retain a displayable result: query, limit, useToolingApi'],
  'doctor': ['doctor', 'local', 'Check Salesforce CLI and project health'],
  'source.list': ['agents.list', 'org', 'List editable source versions in the selected org'],
  'source.retrieve': ['agents.retrieve.start', 'org', 'Retrieve exact source: fullName, orgId'],
  'source.status': ['agents.retrieve.status', 'local', 'Poll retrieval: jobId'],
  'source.cancel': ['agents.retrieve.cancel', 'local', 'Cancel retrieval: jobId'],
  'draft.destination': ['agents.draft.destination', 'local', 'Inspect local draft destination'],
  'draft.create': ['agents.draft.create', 'local', 'Create a complete local draft: name, apiName, purpose; optional source for a copy'],
  'files.list': ['agentFiles.list', 'local', 'List local Agentforce sources'],
  'files.read': ['agentFiles.read', 'local', 'Read local source and revision: path'],
  'files.write': ['agentFiles.write', 'local', 'Save local source: path, content, expectedSha256'],
  'source.parse': ['agentScript.parse', 'local', 'Diagnostics, graph and actions: source'],
  'source.query': ['agentScript.query', 'local', 'Language service: source, query, line, column'],
  'actions.source': ['agentActions.source', 'conditional', 'Inspect Apex/Flow implementation: target, origin, candidate'],
  'studio.start': ['agentLab.start', 'org', 'Preview/rehearsal of a source snapshot: source, engine, model, scenario'],
  'studio.send': ['agentLab.send', 'org', 'Talk to Studio session: id, text'],
  'studio.next': ['agentLab.next', 'org', 'Generate next scenario turn: id'],
  'studio.evaluate': ['agentLab.evaluate', 'org', 'Evaluate Studio scenario: id'],
  'studio.end': ['agentLab.end', 'local', 'End Studio session: id'],
  'metadata.list': ['metadata.list', 'org', 'List metadata: metadataType'],
  'operations.start': ['operations.start', 'self', 'Preview/validate/deploy/retrieve or targeted tests: kind, components, tests'],
  'operations.list': ['operations.list', 'local', 'Shared operation history'],
  'operations.report': ['operations.report', 'org', 'Refresh a submitted operation: operationId'],
  'records.get': ['records.get', 'org', 'Read a record: objectName, recordId'],
  'logs.get': ['logs.get', 'org', 'Read a specific debug log: logId'],
  'query.more': ['soql.queryMore', 'org', 'Read next bounded page: nextRecordsUrl'],
  'query.explain': ['soql.explain', 'org', 'Explain a SOQL query: query'],
  'query.cancel': ['soql.abort', 'local', 'Cancel a query: requestId'],
  'query.history': ['soql.history.list', 'local', 'List recent and saved queries'],
  'query.save': ['soql.history.save', 'local', 'Save a named query: name, soql'],
  'query.remove': ['soql.history.remove', 'local', 'Remove a saved query: id'],
  'org.limits': ['soql.limits', 'org', 'Read org API usage'],
  'ui.views': ['control.views', 'local', 'List active workbench surfaces and their view IDs'],
  'ui.command': ['control.command', 'local', 'Control a specific view: viewId, command, input; poll ui.result for acknowledgement'],
  'ui.result': ['control.result', 'local', 'Check UI acknowledgement: commandId'],
} as const;
export type WorkbenchAction = keyof typeof WORKBENCH_ACTIONS;
export const workbenchActionNames = Object.keys(WORKBENCH_ACTIONS) as WorkbenchAction[];
export const isWorkbenchAction = (name: string): name is WorkbenchAction => Object.hasOwn(WORKBENCH_ACTIONS, name);
export const actionParameters = {
  type: 'object', properties: { action: { type: 'string', enum: workbenchActionNames }, input: { type: 'object', description: 'Action-specific fields; use capabilities for parameter descriptions.' } }, required: ['action'],
};
export function actionInput(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 200_000) throw Error('Action input must be an object of at most 200,000 characters.');
  const { projectId: _project, threadId: _thread, orgAlias: _alias, ...input } = value as Record<string, unknown>;
  return input;
}
export function actionCatalog() {
  return workbenchActionNames.map(action => ({ action, description: WORKBENCH_ACTIONS[action][2] }));
}
