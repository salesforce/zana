import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import {
  DEFAULT_WORKFLOW_SETTINGS,
  WORKFLOW_SETTING_DESCRIPTORS,
  parseStoredWorkflowSettings,
  registerWorkflowSettings,
  validateWorkflowSettings,
  type WorkflowSettings
} from './settings.js';

function rawSettings(overrides: Partial<WorkflowSettings> = {}): WorkflowSettings {
  return {
    maxActiveRuns: 4,
    maxConcurrentAgents: 8,
    maxAgentCalls: 100,
    totalRunTimeoutMs: 86_400_000,
    retentionDays: 30,
    maxNotificationBytes: 16_384,
    ...overrides
  };
}

describe('workflow settings policy', () => {
  it('keeps descriptor defaults aligned with immutable defaults', () => {
    expect(validateWorkflowSettings({
      maxActiveRuns: WORKFLOW_SETTING_DESCRIPTORS.maxActiveRuns.default,
      maxConcurrentAgents: WORKFLOW_SETTING_DESCRIPTORS.maxConcurrentAgents.default,
      maxAgentCalls: WORKFLOW_SETTING_DESCRIPTORS.maxAgentCalls.default,
      totalRunTimeoutMs: WORKFLOW_SETTING_DESCRIPTORS.totalRunTimeoutMs.default,
      retentionDays: WORKFLOW_SETTING_DESCRIPTORS.retentionDays.default,
      maxNotificationBytes: WORKFLOW_SETTING_DESCRIPTORS.maxNotificationBytes.default
    })).toEqual(DEFAULT_WORKFLOW_SETTINGS);
    expect(Object.isFrozen(DEFAULT_WORKFLOW_SETTINGS)).toBe(true);
  });

  it('enforces integer bounds', () => {
    expect(() => validateWorkflowSettings(rawSettings({ maxActiveRuns: 0 }))).toThrow(
      /Maximum active runs/
    );
    expect(() => validateWorkflowSettings(rawSettings({ maxActiveRuns: 33 }))).toThrow(
      /Maximum active runs/
    );
  });

  it('registers descriptors on the fake host', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'workflows' });
    const settings = registerWorkflowSettings(zcc);
    expect(harness.settings).toEqual(WORKFLOW_SETTING_DESCRIPTORS);
    await expect(settings.get()).resolves.toEqual(DEFAULT_WORKFLOW_SETTINGS);
    const changes: WorkflowSettings[] = [];
    settings.onChange((next) => changes.push(next));
    harness.setSettings({ maxConcurrentAgents: 12 });
    expect(changes.at(-1)?.maxConcurrentAgents).toBe(12);
  });

  it('round-trips snapshots and ignores the retired stall timeout', () => {
    expect(parseStoredWorkflowSettings(DEFAULT_WORKFLOW_SETTINGS)).toEqual(
      DEFAULT_WORKFLOW_SETTINGS
    );
    expect(
      parseStoredWorkflowSettings({
        ...DEFAULT_WORKFLOW_SETTINGS,
        workerStallTimeoutMs: 1_800_000
      })
    ).toEqual(DEFAULT_WORKFLOW_SETTINGS);
    expect(() => parseStoredWorkflowSettings({ maxActiveRuns: 4 })).toThrow(/unexpected fields/);
  });
});
