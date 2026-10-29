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
  'sync.check': ['sync.check', 'org', 'Compare org metadata with local source (Fetch latest): scope agentforce|apex|all, or agent <BundleName> for one local agent plus the Apex, Flows and prompt templates its actions call (adds agent.current and agent.missing). Lists changed, conflict, new, unknown and deleted components with full counts; optional states [..] and limit (agents default to 1000 rows)'],
  'sync.fetch': ['sync.fetch.start', 'org', 'Retrieve components into a private plan without touching the project: components ["Type:fullName"], orgId'],
  'sync.status': ['sync.fetch.status', 'local', 'Poll a fetch and read its file plan (same/update/create/conflict): jobId'],
  'sync.diff': ['sync.diff', 'local', 'Local and org text of one planned file: jobId, path'],
  'sync.apply': ['sync.apply', 'local', 'Write planned updates and creations; conflicts stay local unless listed: jobId, take [paths]'],
  'sync.cancel': ['sync.cancel', 'local', 'Discard a fetch plan: jobId'],
  'draft.destination': ['agents.draft.destination', 'local', 'Inspect local draft destination'],
  'draft.create': ['agents.draft.create', 'local', 'Create a complete local draft: name, apiName, purpose; optional source for a copy'],
  'files.list': ['agentFiles.list', 'local', 'List local Agentforce sources'],
  'files.read': ['agentFiles.read', 'local', 'Read local source and revision: path'],
  'files.write': ['agentFiles.write', 'local', 'Save local source: path, content, expectedSha256'],
  'source.parse': ['agentScript.parse', 'local', 'Diagnostics, graph and actions: source or confined path; optional expectedSha256 pins the saved revision'],
  'source.query': ['agentScript.query', 'local', 'Language service: source, query, line, column'],
  'actions.source': ['agentActions.source', 'conditional', 'Inspect Apex/Flow implementation: target, origin, candidate'],
  'studio.start': ['agentLab.start', 'org', 'Preview/rehearsal of a source snapshot: source or confined path (optional expectedSha256), engine, model, scenario; optional contextVariables [{name,type,value}] (linked names $Context.Name, external state names bare), or presetId with path to start from a saved context preset. Initial values are pinned to the run'],
  'context.fields': ['agentPreview.context', 'local', 'Preview context a local agent accepts: path (or source). Returns fields: name, label, type, defaultValue, description, source (linked $Context.* names read a session field such as @MessagingSession.Id)'],
  'contextPresets.list': ['agentPreview.presets.list', 'local', 'Saved preview context presets of one agent and the selected org: path. Returns presets (id, name, revision, values, savedBy)'],
  'contextPresets.save': ['agentPreview.presets.save', 'local', 'Create or update a preview context preset the user sees in Preview: path, name (1-60), values [{name, value, type?}] (type defaults to the declared one; undeclared names become manual variables). Update with id and expectedRevision. 20 per agent and org. To show it, ui.command context.set {presetId}'],
  'contextPresets.remove': ['agentPreview.presets.remove', 'local', 'Delete a preview context preset: path, id, optional expectedRevision'],
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
  'view.state': ['studio.view.get', 'local', 'Read what the user is viewing in Studio (path, selection, diagnostics, tool)'],
  'comments.list': ['studio.comments.list', 'local', 'List review comments: path, includeResolved'],
  'comments.add': ['studio.comments.add', 'local', 'Add a review comment: path, line, endLine, body'],
  'comments.resolve': ['studio.comments.resolve', 'local', 'Resolve a review comment: id, note'],
  'comments.update': ['studio.comments.update', 'local', 'Edit the body of your own open review comment: id, body'],
  'comments.delete': ['studio.comments.delete', 'local', 'Delete your own review comment: id'],
  'suites.list': ['studio.suites.list', 'local', 'List scenario suites and last results'],
  'scenarios.list': ['studio.scenarios.list', 'local', 'List shared AI conversation scenarios for one saved agent: agentPath. Returns id, name, revision, persona, goal, opening, criteria, maxTurns and typed contextVariables. Reuse the returned fields and contextVariables in studio.start or simulations.start, with origin:{id,name,revision} to pin provenance. These generate conversations; saved test cases replay fixed messages'],
  'scenarios.save': ['studio.scenarios.save', 'local', 'Save a shared scenario: agentPath, name, persona, goal, opening, criteria, maxTurns 1-8, optional contextVariables. To update include id and expectedRevision from scenarios.list; omit id to save a new copy. Does not run an org action'],
  'scenarios.remove': ['studio.scenarios.remove', 'local', 'Remove a shared scenario: agentPath, id, expectedRevision. Existing run and case snapshots remain unchanged'],
  'suites.save': ['studio.suites.save', 'local', 'Create or update saved test cases: agentPath or path (tests/<Name>.scenario.json), cases [{id, name, utterances: string[], expect: {topic?, actions?, contains?, forbiddenActions?, criteria?}, contextVariables?: [{name,type,value}]}]. Read suites.list first; when updating supply expectedSha256 from the suite sha256 to preserve concurrent edits. Stores local cases without running them. Run with suites.run'],
  'suites.run': ['studio.suites.start', 'org', 'Start a background scenario suite in Simulate: agentPath; returns jobId immediately; poll suites.result and read result.next when completed; cancel with suites.stop; optional source (a candidate, else the saved file), caseIds, loopId. With loopId, each run spends one attempt of a fix loop the user started, runs only its cases and is not stored; follow the returned next'],
  'suites.start': ['studio.suites.start', 'org', 'Start a background suite: same input as suites.run, optional requestId for retry deduplication. Returns jobId immediately; poll suites.result, cancel with suites.stop. Results survive view closure; retained for this plugin session.'],
  'suites.result': ['studio.suites.result', 'local', 'Read background suite status and result: jobId. Missing/expired jobs are explicit; never rerun automatically.'],
  'suites.stop': ['studio.suites.stop', 'local', 'Cancel background suite and close its active preview: jobId'],
  'suites.compare': ['studio.suites.start', 'org', 'Compare the saved local agent against candidate source on the same complete scenario suite (at most 20 cases): agentPath, source. Both run in Simulate, with identical messages and context. Returns jobId immediately; poll suites.result for comparison with source hashes, reference and candidate results, replies, actions and maximum response latency. Does not save the candidate or replace ordinary results'],
  'simulations.start': ['studio.simulations.start', 'org', 'Simulation lab: run up to 12 AI role-play conversations against a local agent, 4 at a time. An AI customer plays each scenario, the agent answers in Simulate (engine preview, simulated actions; default) or rehearsal, and an AI judge grades the transcript against the criteria. Input: agentPath; optional source (a candidate, else the saved file), scenarios [{name?, persona, goal, opening, criteria, maxTurns 1-8, contextVariables?: [{name,type,value}]}] (default: Happy path, Missing details, Stay in scope), repeats 1-3, parallel 1-4, contextVariables (batch defaults; scenario variables override matching names), model. Returns batchId at once; read simulations.result. To show it, ui.command simulations.open {batchId}. Verdicts are AI opinions, never release evidence'],
  'simulations.result': ['studio.simulations.get', 'local', 'Read a simulation batch: batchId; optional waitMs (at most 60000) waits for it to finish, transcripts false omits turns. Per lane: scenario, status (queued/running/pass/fail/inconclusive/error/stopped), verdict reason and evidence, transcript; next says what to do'],
  'simulations.list': ['studio.simulations.list', 'local', 'List simulation batches of this project, newest first, without transcripts: optional agentPath'],
  'simulations.stop': ['studio.simulations.stop', 'local', 'Stop a running simulation batch: batchId'],
  'selfHealing.start': ['studio.selfHealing.start', 'local', 'Start bounded agent-driven improvement from a completed Simulate batch with failures: batchId, optional source matching that batch, maxAttempts 1-5 (default 3). Scenarios, context and engine are fixed. No file is saved. Returns run and next; the authoring agent should iterate until passed or exhausted'],
  'selfHealing.status': ['studio.selfHealing.status', 'local', 'Read and reconcile self-healing progress: runId (or agentPath for latest), optional waitMs up to 30000, includeSource true returns the best tested source. Follow next. Scores and per-attempt regressions are AI opinions, never release evidence'],
  'selfHealing.evaluate': ['studio.selfHealing.evaluate', 'org', 'Test a candidate in a self-healing run: runId, source. Only the pinned scenarios, repeats, context and Simulate engine are used. Syntax errors and duplicate candidates do not spend an attempt. Regressions cannot replace the best source. Returns immediately; poll selfHealing.status'],
  'selfHealing.stop': ['studio.selfHealing.stop', 'local', 'Stop self-healing and its active conversations: runId. Best tested source remains available for review; nothing is saved'],
  'orgTests.list': ['studio.orgTests.list', 'org', 'List the org\'s Testing Center definitions (AiEvaluationDefinition): optional refresh. Returns name, subject, case count when known'],
  'orgTests.details': ['studio.orgTests.details', 'org', 'Read the agent (subjectName), label and case count of up to 25 org test definitions in one retrieve: names. Returns definitions and missing'],
  'orgTests.definition': ['studio.orgTests.definition', 'org', 'Read one org test definition and its cases (utterance, history, context variables, expectations): name'],
  'orgTests.run': ['studio.orgTests.run.start', 'org', 'Start an org test run of a definition in the org (runs the real agent and consumes org eval capacity): name. Returns runId; poll orgTests.result. To show it to the user, ui.command orgTests.open {runId}'],
  'orgTests.result': ['studio.orgTests.run.get', 'org', 'Read an org test run: runId. Per-case verdict (pass/fail/error/pending), topic, actions, reply and metric results; refreshes while running'],
  'orgTests.cancel': ['studio.orgTests.run.cancel', 'org', 'Cancel a running org test run: runId'],
  'orgTests.runs': ['studio.orgTests.runs', 'local', 'List org test runs started or attached from this project, newest first: optional name'],
  'orgTests.attach': ['studio.orgTests.run.attach', 'org', 'Add an org test run started elsewhere (Testing Center, CI) to the history and read it: runId, optional name'],
  'loop.status': ['studio.loop.get', 'local', 'Read a fix loop the user started in Tests: loopId (or agentPath for the newest)'],
  'preview.trace': ['agentLab.trace', 'org', 'Read the planner trace of a Studio turn: id, planId'],
  'ui.views': ['control.views', 'local', 'List active workbench surfaces and their view IDs, the focused window first; each view names its window (main, project-window, plugin-view for the Studio window) and whether it is visible and focused'],
  'ui.command': ['control.command', 'local', 'Control a specific view: viewId, command, input; poll ui.result for acknowledgement. preview.start accepts engine and optional contextVariables [{name,type,value}] or presetId, and shows the applied context in Preview. context.set {values} or {presetId} fills the Preview Context tab for the user to review without starting a run (merge: true keeps the other overrides). A reveal (file.open, editor.reveal, trace.focus, graph.focus) can complete with viewState.held "typing" or "paused": the Studio holds it for the user, so do not repeat it. orgTests.open {name?, runId?} opens the Org tests tab on a definition or run, which then follows the run live. simulations.open {batchId?} opens the Simulations view on a batch (the newest without batchId) and follows it live'],
  'ui.result': ['control.result', 'local', 'Check UI acknowledgement: commandId'],
} as const;
export type WorkbenchAction = keyof typeof WORKBENCH_ACTIONS;
export const workbenchActionNames = Object.keys(WORKBENCH_ACTIONS) as WorkbenchAction[];
export const isWorkbenchAction = (name: string): name is WorkbenchAction => Object.hasOwn(WORKBENCH_ACTIONS, name);
export const actionParameters = {
  type: 'object', properties: { action: { type: 'string', enum: workbenchActionNames }, input: { type: 'object', description: 'Action-specific fields; use capabilities for parameter descriptions.' } }, required: ['action'],
};
export function actionInput(value: unknown, action?: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Action input must be an object of at most 200,000 characters.');
  const bounded = { ...value } as Record<string, unknown>;
  // Source-bearing operations share the editor's 10 MB bound; unrelated input
  // keeps the small envelope. Never grant this exception to arbitrary fields.
  const field = action === 'files.write' ? 'content' : ['studio.start', 'source.parse', 'source.query', 'suites.run', 'suites.start', 'suites.compare', 'draft.create', 'simulations.start', 'selfHealing.start', 'selfHealing.evaluate'].includes(action ?? '') ? 'source' : null;
  if (field && typeof bounded[field] === 'string') {
    if ((bounded[field] as string).length > 10 * 1024 * 1024) throw Error('Agent source exceeds 10 MB.');
    delete bounded[field];
  }
  if (JSON.stringify(bounded).length > 200_000) throw Error('Action input must be an object of at most 200,000 characters.');
  // startedByUser marks a click in the Studio; an agent can never claim it.
  const { projectId: _project, threadId: _thread, orgAlias: _alias, startedByUser: _user, ...input } = value as Record<string, unknown>;
  return input;
}
export function actionCatalog() {
  return workbenchActionNames.map(action => ({ action, description: WORKBENCH_ACTIONS[action][2] }));
}
