import { describe, expect, it } from 'vitest';
import {
  HARNESS_ROUTING_MIGRATION_INVENTORY,
  projectSharedModelProjections,
  projectValueProjection,
  type HarnessRoutingMigrationStore
} from '../harness-routing-migration/index.js';

const expectedKeys: Record<HarnessRoutingMigrationStore, string[]> = {
  'app-config': [
    'claudeBinary',
    'cursorBinary',
    'codexBinary',
    'piBinary',
    'opencodeBinary',
    'harnessCursorEnabled',
    'harnessCodexEnabled',
    'harnessPiEnabled',
    'harnessOpenCodeEnabled',
    'defaultModel',
    'defaultPermissionMode',
    'claudeAppendSystemPrompt',
    'claudeExtraArgs',
    'claudeAddDirs',
    'claudeAllowedTools',
    'claudeDeniedTools',
    'defaultCodexSandbox',
    'defaultCodexApproval',
    'autoModeEnabled',
    'autoModeEnvironment',
    'autoModeAllow',
    'autoModeSoftDeny',
    'autoModeHardDeny',
    'autoModeClassifyAllShell',
    'piProvider',
    'piModel',
    'piThinking',
    'defaultHarness',
    'harnessRouting',
    'defaultExecutionState',
    'harnesses'
  ],
  projects: ['defaultAgents', 'defaultPersonas', 'launchDefault'],
  'project-settings': [
    'appendSystemPrompt',
    'extraArgs',
    'addDirs',
    'allowedTools',
    'deniedTools',
    'model',
    'permissionMode',
    'codexSandbox',
    'codexApproval',
    'piProvider',
    'piModel',
    'piThinking',
    'modelLevel',
    'executionState',
    'harnessRouting',
    'harnesses'
  ],
  personas: [
    'baseProfile',
    'model',
    'permissionMode',
    'codexSandbox',
    'codexApproval',
    'modelLevel',
    'executionState',
    'harnessRouting',
    'appendSystemPrompt',
    'allowedTools',
    'deniedTools',
    'addDirs',
    'mcpServers',
    'initialPrompt'
  ],
  schedules: ['profile', 'personaId', 'extraArgs'],
  templates: ['defaults.profile', 'defaults.extraArgs'],
  teams: ['orchestratorPersonaId', 'slots[].personaId'],
  'extension-personas': ['registration'],
  'extension-teams': ['registration']
};

describe('harness routing migration inventory', () => {
  it('classifies every known routing key in every owning store', () => {
    const byStore = Object.fromEntries(
      Object.keys(expectedKeys).map((store) => [
        store,
        HARNESS_ROUTING_MIGRATION_INVENTORY
          .filter((entry) => entry.store === store)
          .map((entry) => entry.key)
      ])
    );

    expect(byStore).toEqual(expectedKeys);
  });

  it('keeps canonical values authoritative over projected legacy values', () => {
    expect(projectValueProjection({
      canonical: { modelTargetId: 'canonical-model' },
      legacy: 'legacy-model',
      sourceKey: 'model',
      destination: 'harnesses.byId.claude.compatibility.model'
    })).toEqual({
      value: { modelTargetId: 'canonical-model' },
      provenance: 'canonical'
    });

    expect(projectValueProjection({
      legacy: ' legacy-model ',
      sourceKey: 'model',
      destination: 'harnesses.byId.claude.compatibility.model'
    })).toEqual({
      value: ' legacy-model ',
      provenance: 'legacy-projection',
      sourceKeys: ['model'],
      destination: 'harnesses.byId.claude.compatibility.model',
      confidence: 'exact',
      reason: 'Legacy model projects exactly until canonical storage exists'
    });
  });

  it('projects neutral shared model ownership only to historical consumers', () => {
    expect(projectSharedModelProjections('o3')).toEqual([
      {
        value: 'o3',
        sourceKeys: ['model'],
        destination: 'harnesses.byId.claude.compatibility.model',
        confidence: 'exact',
        reason: 'Claude historically consumed ProjectSettings.model'
      },
      {
        value: 'o3',
        sourceKeys: ['model'],
        destination: 'harnesses.byId.codex.compatibility.model',
        confidence: 'exact',
        reason: 'Codex historically consumed ProjectSettings.model'
      }
    ]);
  });

  it('freezes schedules and templates as explicit canonical profile owners', () => {
    expect(HARNESS_ROUTING_MIGRATION_INVENTORY).toEqual(expect.arrayContaining([
      expect.objectContaining({ store: 'schedules', key: 'profile', classification: 'already-canonical' }),
      expect.objectContaining({ store: 'templates', key: 'defaults.profile', classification: 'already-canonical' })
    ]));
  });

  it('classifies extension persona and team registrations as ephemeral', () => {
    expect(HARNESS_ROUTING_MIGRATION_INVENTORY).toEqual(expect.arrayContaining([
      expect.objectContaining({ store: 'extension-personas', key: 'registration', classification: 'ephemeral' }),
      expect.objectContaining({ store: 'extension-teams', key: 'registration', classification: 'ephemeral' })
    ]));
  });
});
