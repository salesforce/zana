import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { harnessFamilyOf, parseProfile } from '../../shared/launch-provider.js';
import { runJournaledMigration, type MigrationJournalState } from './journal.js';
import {
  atomicDurableWrite,
  hashBytes,
  readRawFile,
  runSerializedMigrationTransaction
} from './storage.js';

export interface HarnessRoutingMigrationDeps {
  afterState?: (operationId: string, state: MigrationJournalState) => void;
}

export interface HarnessRoutingMigrationResult {
  migrated: number;
  noOp: boolean;
}

type JsonObject = Record<string, any>;

const LEGACY_CONFIG_KEYS = [
  'claudeBinary', 'cursorBinary', 'codexBinary', 'piBinary', 'opencodeBinary',
  'harnessCursorEnabled', 'harnessCodexEnabled', 'harnessPiEnabled', 'harnessOpenCodeEnabled',
  'defaultModel', 'defaultPermissionMode', 'claudeAppendSystemPrompt', 'claudeExtraArgs',
  'claudeAddDirs', 'claudeAllowedTools', 'claudeDeniedTools', 'defaultCodexSandbox',
  'defaultCodexApproval', 'autoModeEnabled', 'autoModeEnvironment', 'autoModeAllow',
  'autoModeSoftDeny', 'autoModeHardDeny', 'autoModeClassifyAllShell', 'piProvider', 'piModel', 'piThinking'
] as const;

const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const bytes = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function compatibility(root: JsonObject, adapter: string): JsonObject {
  root.harnesses ??= {};
  root.harnesses.byId ??= {};
  root.harnesses.byId[adapter] ??= {};
  root.harnesses.byId[adapter].compatibility ??= {};
  return root.harnesses.byId[adapter].compatibility;
}

function setUnlessCanonical(target: JsonObject, key: string, value: unknown, canonical?: JsonObject, canonicalKey?: string): void {
  if (value === undefined || own(target, key) || (canonical && own(canonical, canonicalKey ?? key))) return;
  target[key] = value;
}

function projectConfig(raw: JsonObject): JsonObject {
  const next = clone(raw);
  const byId = next.harnesses?.byId ?? {};
  const adapters = [
    ['claude', 'claudeBinary', undefined],
    ['cursor', 'cursorBinary', 'harnessCursorEnabled'],
    ['codex', 'codexBinary', 'harnessCodexEnabled'],
    ['pi', 'piBinary', 'harnessPiEnabled'],
    ['opencode', 'opencodeBinary', 'harnessOpenCodeEnabled']
  ] as const;
  for (const [id, binaryKey, enabledKey] of adapters) {
    if (own(next, binaryKey) || (enabledKey && own(next, enabledKey))) {
      next.harnesses ??= {};
      next.harnesses.byId ??= {};
      next.harnesses.byId[id] ??= {};
      if (!own(next.harnesses.byId[id], 'binary') && own(next, binaryKey)) next.harnesses.byId[id].binary = next[binaryKey];
      if (enabledKey && !own(next.harnesses.byId[id], 'enabled') && own(next, enabledKey)) next.harnesses.byId[id].enabled = next[enabledKey];
    }
  }
  const claude = compatibility(next, 'claude');
  setUnlessCanonical(claude, 'model', next.defaultModel, next.harnessRouting?.byAdapter?.claude, 'modelTargetId');
  const canonicalClaudeExecution = next.harnessRouting?.byAdapter?.claude;
  const hasCanonicalClaudeExecution = own(claude, 'executionPolicy') || own(claude, 'permissionMode') ||
    !!canonicalClaudeExecution && (own(canonicalClaudeExecution, 'executionState') || own(canonicalClaudeExecution, 'executionTargetId'));
  const claudeOpaque = [
    ['appendSystemPrompt', 'claudeAppendSystemPrompt'], ['extraArgs', 'claudeExtraArgs'],
    ['addDirs', 'claudeAddDirs'], ['allowedTools', 'claudeAllowedTools'], ['deniedTools', 'claudeDeniedTools']
  ] as const;
  for (const [destination, source] of claudeOpaque) setUnlessCanonical(claude, destination, next[source]);
  const autoKeys = [
    ['enabled', 'autoModeEnabled'], ['environment', 'autoModeEnvironment'], ['allow', 'autoModeAllow'],
    ['softDeny', 'autoModeSoftDeny'], ['hardDeny', 'autoModeHardDeny'], ['classifyAllShell', 'autoModeClassifyAllShell']
  ] as const;
  const hasLegacyAuto = autoKeys.some(([, source]) => own(next, source));
  const legacyNativeDefault = next.defaultPermissionMode === undefined || next.defaultPermissionMode === 'default';
  if (!hasCanonicalClaudeExecution && legacyNativeDefault) {
    claude.executionPolicy = { target: 'native-default-with-auto' };
    if (hasLegacyAuto) {
      claude.executionPolicy.autoMode = {};
      for (const [destination, source] of autoKeys) setUnlessCanonical(claude.executionPolicy.autoMode, destination, next[source]);
    }
  } else {
    setUnlessCanonical(claude, 'permissionMode', next.defaultPermissionMode, canonicalClaudeExecution, 'executionState');
    if (hasLegacyAuto) {
      claude.autoMode ??= {};
      for (const [destination, source] of autoKeys) setUnlessCanonical(claude.autoMode, destination, next[source]);
    }
  }
  const codex = compatibility(next, 'codex');
  setUnlessCanonical(codex, 'codexSandbox', next.defaultCodexSandbox);
  setUnlessCanonical(codex, 'codexApproval', next.defaultCodexApproval);
  const pi = compatibility(next, 'pi');
  setUnlessCanonical(pi, 'provider', next.piProvider, next.harnessRouting?.byAdapter?.pi, 'providerTargetId');
  setUnlessCanonical(pi, 'model', next.piModel, next.harnessRouting?.byAdapter?.pi, 'modelTargetId');
  setUnlessCanonical(pi, 'thinking', next.piThinking);
  for (const key of LEGACY_CONFIG_KEYS) delete next[key];
  return next;
}

function profileFamily(profile: unknown): string | undefined {
  if (typeof profile !== 'string') return undefined;
  const canonical = parseProfile(profile);
  return canonical ? harnessFamilyOf(canonical) ?? undefined : undefined;
}

function projectPersona(raw: JsonObject): JsonObject {
  const next = clone(raw);
  const pinned = profileFamily(next.baseProfile);
  if (own(next, 'baseProfile') && !pinned) return next;
  const destinations = pinned ? [pinned] : ['claude', 'codex'];
  for (const adapter of destinations) {
    next.harnessRouting ??= { schemaVersion: 1, byAdapter: {} };
    next.harnessRouting.byAdapter ??= {};
    next.harnessRouting.byAdapter[adapter] ??= {};
    const intent = next.harnessRouting.byAdapter[adapter];
    intent.compatibility ??= {};
    setUnlessCanonical(intent.compatibility, 'model', next.model, intent, 'modelTargetId');
  }
  if (own(next, 'permissionMode')) {
    next.harnessRouting ??= { schemaVersion: 1, byAdapter: {} };
    next.harnessRouting.byAdapter.claude ??= {};
    const intent = next.harnessRouting.byAdapter.claude;
    intent.compatibility ??= {};
    setUnlessCanonical(intent.compatibility, 'permissionMode', next.permissionMode, intent, 'executionTargetId');
  }
  if (own(next, 'codexSandbox') || own(next, 'codexApproval')) {
    next.harnessRouting ??= { schemaVersion: 1, byAdapter: {} };
    next.harnessRouting.byAdapter.codex ??= {};
    const compat = next.harnessRouting.byAdapter.codex.compatibility ??= {};
    setUnlessCanonical(compat, 'codexSandbox', next.codexSandbox);
    setUnlessCanonical(compat, 'codexApproval', next.codexApproval);
  }
  delete next.model;
  delete next.permissionMode;
  delete next.codexSandbox;
  delete next.codexApproval;
  return next;
}

function projectSettingsFile(raw: JsonObject): JsonObject {
  const next = clone(raw);
  for (const settings of Object.values(next) as JsonObject[]) {
    const claude = compatibility(settings, 'claude');
    const codex = compatibility(settings, 'codex');
    const pi = compatibility(settings, 'pi');
    setUnlessCanonical(claude, 'model', settings.model, settings.harnessRouting?.byAdapter?.claude, 'modelTargetId');
    setUnlessCanonical(codex, 'model', settings.model, settings.harnessRouting?.byAdapter?.codex, 'modelTargetId');
    setUnlessCanonical(claude, 'permissionMode', settings.permissionMode, settings.harnessRouting?.byAdapter?.claude, 'executionState');
    for (const key of ['appendSystemPrompt', 'extraArgs', 'addDirs', 'allowedTools', 'deniedTools']) {
      setUnlessCanonical(claude, key, settings[key]);
    }
    setUnlessCanonical(codex, 'codexSandbox', settings.codexSandbox);
    setUnlessCanonical(codex, 'codexApproval', settings.codexApproval);
    setUnlessCanonical(pi, 'provider', settings.piProvider, settings.harnessRouting?.byAdapter?.pi, 'providerTargetId');
    setUnlessCanonical(pi, 'model', settings.piModel, settings.harnessRouting?.byAdapter?.pi, 'modelTargetId');
    setUnlessCanonical(pi, 'thinking', settings.piThinking);
    for (const key of ['model', 'permissionMode', 'appendSystemPrompt', 'extraArgs', 'addDirs', 'allowedTools', 'deniedTools', 'codexSandbox', 'codexApproval', 'piProvider', 'piModel', 'piThinking']) delete settings[key];
  }
  return next;
}

function projectProjectsFile(raw: JsonObject, personas: Map<string, JsonObject>): JsonObject {
  const next = clone(raw);
  const projects: JsonObject[] = Array.isArray(next) ? next : next.projects ?? [];
  for (const project of projects) {
    if (!project.launchDefault) {
      const hasLegacySelection = (Array.isArray(project.defaultAgents) && project.defaultAgents.length > 0)
        || (Array.isArray(project.defaultPersonas) && project.defaultPersonas.length > 0);
      const personaId = Array.isArray(project.defaultPersonas)
        ? project.defaultPersonas.find((id: unknown) => typeof id === 'string' && personas.has(id))
        : undefined;
      const persona = personaId ? personas.get(personaId) : undefined;
      const profile = persona?.baseProfile ?? (persona ? 'claude' : Array.isArray(project.defaultAgents)
        ? project.defaultAgents.find((value: unknown) => profileFamily(value))
        : undefined);
      const adapterId = profileFamily(profile);
      if (profile && adapterId) {
        project.launchDefault = {
          schemaVersion: 1, kind: 'exact-profile', ...(personaId ? { personaId } : {}), adapterId, profileId: profile, source: 'migration'
        };
      } else if (!hasLegacySelection) {
        project.launchDefault = { schemaVersion: 1, kind: 'use-global', source: 'migration' };
      }
    }
    const unresolvedLegacySelection = !project.launchDefault
      && ((Array.isArray(project.defaultAgents) && project.defaultAgents.length > 0)
        || (Array.isArray(project.defaultPersonas) && project.defaultPersonas.length > 0));
    if (!unresolvedLegacySelection) {
      delete project.defaultAgents;
      delete project.defaultPersonas;
    }
  }
  return next;
}

function parse(bytesValue: Buffer): JsonObject {
  return JSON.parse(bytesValue.toString('utf8')) as JsonObject;
}

function operationPaths(dataDir: string, operationId: string) {
  const dir = join(dataDir, 'harness-routing-migration');
  return {
    dir,
    journal: join(dir, `${operationId}.json`),
    source: join(dir, `${operationId}.source.json`),
    backup: join(dir, `${operationId}.backup.json`)
  };
}

function migrateFile(
  dataDir: string,
  operationId: string,
  target: string,
  projection: (raw: JsonObject) => JsonObject,
  deps: HarnessRoutingMigrationDeps
): boolean {
  const paths = operationPaths(dataDir, operationId);
  const journal = readRawFile(paths.journal);
  let priorState: unknown;
  if (journal) {
    try { priorState = parse(journal).state; } catch { /* journal runner reports bounded repair error */ }
  }
  const targetRaw = readRawFile(target);
  if (!journal && !targetRaw && !readRawFile(paths.source)) return false;
  mkdirSync(paths.dir, { recursive: true });
  if (!journal && !readRawFile(paths.source)) atomicDurableWrite(paths.source, targetRaw!, { expectedHash: null });
  const sourceRaw = readRawFile(paths.source);
  const canonical = journal ? undefined : bytes(projection(parse(sourceRaw!)));
  runJournaledMigration({
    operationId,
    journalPath: paths.journal,
    legacyPath: paths.source,
    canonicalPath: target,
    backupPath: paths.backup,
    legacyExpectedHash: sourceRaw ? hashBytes(sourceRaw) : undefined,
    canonicalExpectedHash: journal ? undefined : hashBytes(targetRaw ?? sourceRaw!),
    canonicalBytes: canonical,
    afterState: (state) => deps.afterState?.(operationId, state)
  });
  return priorState !== 'complete';
}

export async function runHarnessRoutingMigration(
  dataDir: string,
  deps: HarnessRoutingMigrationDeps = {}
): Promise<HarnessRoutingMigrationResult> {
  return runSerializedMigrationTransaction(async () => {
    const personaDir = join(dataDir, 'personas');
    const personaNames = (existsSync(personaDir) ? readdirSync(personaDir, { withFileTypes: true }) : [])
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
    const personas = new Map<string, JsonObject>();
    for (const name of personaNames) {
      const raw = readRawFile(join(personaDir, name));
      if (raw) {
        const persona = parse(raw);
        if (typeof persona.id === 'string') personas.set(persona.id, persona);
      }
    }
    let migrated = 0;
    if (migrateFile(dataDir, 'app-config-v1', join(dataDir, 'config.json'), projectConfig, deps)) migrated++;
    for (const name of personaNames) {
      const id = `persona-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}-v1`;
      if (migrateFile(dataDir, id, join(personaDir, name), projectPersona, deps)) migrated++;
    }
    if (migrateFile(dataDir, 'projects-v1', join(dataDir, 'projects.json'), (raw) => projectProjectsFile(raw, personas), deps)) migrated++;
    if (migrateFile(dataDir, 'project-settings-v1', join(dataDir, 'project-settings.json'), projectSettingsFile, deps)) migrated++;
    return { migrated, noOp: migrated === 0 };
  });
}
