export { runHarnessRoutingMigration } from './migrator.js';
export type { HarnessRoutingMigrationDeps, HarnessRoutingMigrationResult } from './migrator.js';

export type HarnessRoutingMigrationStore =
  | 'app-config'
  | 'projects'
  | 'project-settings'
  | 'personas'
  | 'schedules'
  | 'templates'
  | 'teams'
  | 'extension-personas'
  | 'extension-teams';

export type HarnessRoutingMigrationClassification =
  | 'exact-canonical'
  | 'blocked'
  | 'already-canonical'
  | 'opaque-compatibility'
  | 'unrelated'
  | 'ephemeral';

export interface HarnessRoutingMigrationInventoryEntry {
  store: HarnessRoutingMigrationStore;
  key: string;
  classification: HarnessRoutingMigrationClassification;
  destination?: string;
  reason: string;
}

const entries = (
  store: HarnessRoutingMigrationStore,
  classification: HarnessRoutingMigrationClassification,
  reason: string,
  keys: readonly string[]
): HarnessRoutingMigrationInventoryEntry[] => keys.map((key) => ({
  store,
  key,
  classification,
  reason
}));

export const HARNESS_ROUTING_MIGRATION_INVENTORY: readonly HarnessRoutingMigrationInventoryEntry[] = [
  ...entries('app-config', 'exact-canonical', 'Move adapter-owned binary and enablement exactly', [
    'claudeBinary', 'cursorBinary', 'codexBinary', 'piBinary', 'opencodeBinary',
    'harnessCursorEnabled', 'harnessCodexEnabled', 'harnessPiEnabled', 'harnessOpenCodeEnabled'
  ]),
  ...entries('app-config', 'exact-canonical', 'Move Claude model and execution policy as one exact adapter-owned projection', [
    'defaultModel', 'defaultPermissionMode'
  ]),
  ...entries('app-config', 'opaque-compatibility', 'Preserve Claude global prompt, argv, context, and tool lists without reinterpretation', [
    'claudeAppendSystemPrompt', 'claudeExtraArgs', 'claudeAddDirs', 'claudeAllowedTools', 'claudeDeniedTools'
  ]),
  ...entries('app-config', 'exact-canonical', 'Move Codex execution policy to its owning adapter', [
    'defaultCodexSandbox', 'defaultCodexApproval'
  ]),
  ...entries('app-config', 'exact-canonical', 'Move Claude Auto Mode as part of its compound execution policy', [
    'autoModeEnabled', 'autoModeEnvironment',
    'autoModeAllow', 'autoModeSoftDeny', 'autoModeHardDeny', 'autoModeClassifyAllShell'
  ]),
  ...entries('app-config', 'opaque-compatibility', 'Preserve PI partial and fuzzy values byte-for-byte', [
    'piProvider', 'piModel', 'piThinking'
  ]),
  ...entries('app-config', 'already-canonical', 'Retain current canonical routing field', [
    'defaultHarness', 'harnessRouting', 'defaultExecutionState', 'harnesses'
  ]),

  ...entries('projects', 'exact-canonical', 'Project legacy defaults project to one exact launch default', [
    'defaultAgents', 'defaultPersonas'
  ]),
  ...entries('projects', 'already-canonical', 'Retain canonical project launch selection', ['launchDefault']),

  ...entries('project-settings', 'exact-canonical', 'Move Claude-owned project setting exactly', [
    'appendSystemPrompt'
  ]),
  ...entries('project-settings', 'opaque-compatibility', 'Preserve opaque Claude argv and lists without normalization', [
    'extraArgs', 'addDirs', 'allowedTools', 'deniedTools'
  ]),
  ...entries('project-settings', 'exact-canonical', 'Copy shared model only to its historical Claude and Codex consumers', ['model']),
  ...entries('project-settings', 'exact-canonical', 'Move provider execution policy to its owning adapter', [
    'permissionMode', 'codexSandbox', 'codexApproval'
  ]),
  ...entries('project-settings', 'opaque-compatibility', 'Preserve PI project values without claiming structured semantics', [
    'piProvider', 'piModel', 'piThinking'
  ]),
  ...entries('project-settings', 'already-canonical', 'Retain current canonical project routing field', [
    'modelLevel', 'executionState', 'harnessRouting', 'harnesses'
  ]),

  ...entries('personas', 'already-canonical', 'Retain explicit profile identity until canonical neutral representation changes it', ['baseProfile']),
  ...entries('personas', 'exact-canonical', 'Project legacy persona model and execution values to historical owning adapters', [
    'model', 'permissionMode', 'codexSandbox', 'codexApproval'
  ]),
  ...entries('personas', 'already-canonical', 'Retain current canonical portable and adapter-scoped persona intent', [
    'modelLevel', 'executionState', 'harnessRouting'
  ]),
  ...entries('personas', 'already-canonical', 'Retain portable persona facet unchanged', [
    'appendSystemPrompt', 'allowedTools', 'deniedTools', 'addDirs'
  ]),
  ...entries('personas', 'opaque-compatibility', 'Keep legacy Claude-local MCP references opaque', ['mcpServers']),
  ...entries('personas', 'already-canonical', 'Retain explicit opening prompt unchanged', ['initialPrompt']),

  ...entries('schedules', 'already-canonical', 'Explicit schedule launch identity and persona reference remain canonical', [
    'profile', 'personaId'
  ]),
  ...entries('schedules', 'already-canonical', 'Schedule raw arguments remain opaque in their existing canonical field', ['extraArgs']),
  ...entries('templates', 'already-canonical', 'Explicit template profile remains canonical', ['defaults.profile']),
  ...entries('templates', 'already-canonical', 'Template raw arguments remain opaque in their existing canonical field', ['defaults.extraArgs']),
  ...entries('teams', 'already-canonical', 'Team persona references remain canonical', [
    'orchestratorPersonaId', 'slots[].personaId'
  ]),
  ...entries('extension-personas', 'ephemeral', 'Extension persona registry is in-memory and has no durable migration writer', ['registration']),
  ...entries('extension-teams', 'ephemeral', 'Extension team registry is in-memory and has no durable migration writer', ['registration'])
];

export interface LegacyProjection<T> {
  value: T;
  sourceKeys: string[];
  destination: string;
  confidence: 'exact';
  reason: string;
}

export type EffectiveProjection<TCanonical, TLegacy> =
  | { value: TCanonical; provenance: 'canonical' }
  | ({ provenance: 'legacy-projection' } & LegacyProjection<TLegacy>);

export function projectValueProjection<TCanonical, TLegacy>(input: {
  canonical?: TCanonical;
  legacy: TLegacy;
  sourceKey: string;
  destination: string;
}): EffectiveProjection<TCanonical, TLegacy> {
  if (input.canonical !== undefined) {
    return { value: input.canonical, provenance: 'canonical' };
  }
  return {
    value: input.legacy,
    provenance: 'legacy-projection',
    sourceKeys: [input.sourceKey],
    destination: input.destination,
    confidence: 'exact',
    reason: `Legacy ${input.sourceKey} projects exactly until canonical storage exists`
  };
}

export function projectSharedModelProjections(model: string): LegacyProjection<string>[] {
  return [
    {
      value: model,
      sourceKeys: ['model'],
      destination: 'harnesses.byId.claude.compatibility.model',
      confidence: 'exact',
      reason: 'Claude historically consumed ProjectSettings.model'
    },
    {
      value: model,
      sourceKeys: ['model'],
      destination: 'harnesses.byId.codex.compatibility.model',
      confidence: 'exact',
      reason: 'Codex historically consumed ProjectSettings.model'
    }
  ];
}
