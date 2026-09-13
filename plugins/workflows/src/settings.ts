import type {
  PluginSettingDescriptors,
  PluginSettingValue,
  ZccPluginApi,
} from "@zana-ai/zcc-plugin-sdk/server";
import { z } from "zod";

interface IntegerField {
  label: string;
  minimum: number;
  maximum: number;
}

const INTEGER_FIELDS = Object.freeze({
  maxActiveRuns: {
    label: "Maximum active runs",
    minimum: 1,
    maximum: 32,
  },
  maxConcurrentAgents: {
    label: "Per-run agent concurrency",
    minimum: 1,
    maximum: 64,
  },
  maxAgentCalls: {
    label: "Maximum agent calls",
    minimum: 1,
    maximum: 1_000,
  },
  totalRunTimeoutMs: {
    label: "Total run timeout",
    minimum: 60_000,
    maximum: 604_800_000,
  },
  retentionDays: {
    label: "Retention days",
    minimum: 1,
    maximum: 3_650,
  },
  maxNotificationBytes: {
    label: "Maximum notification bytes",
    minimum: 1_024,
    maximum: 262_144,
  },
});

function boundedIntegerSchema(field: IntegerField) {
  const rangeMessage = `${field.label} must be from ${field.minimum} through ${field.maximum}`;
  return z
    .number()
    .int(`${field.label} must be a whole number`)
    .min(field.minimum, rangeMessage)
    .max(field.maximum, rangeMessage);
}

const workflowSettingsSchema = z.object({
  maxActiveRuns: boundedIntegerSchema(INTEGER_FIELDS.maxActiveRuns),
  maxConcurrentAgents: boundedIntegerSchema(INTEGER_FIELDS.maxConcurrentAgents),
  maxAgentCalls: boundedIntegerSchema(INTEGER_FIELDS.maxAgentCalls),
  totalRunTimeoutMs: boundedIntegerSchema(INTEGER_FIELDS.totalRunTimeoutMs),
  retentionDays: boundedIntegerSchema(INTEGER_FIELDS.retentionDays),
  maxNotificationBytes: boundedIntegerSchema(
    INTEGER_FIELDS.maxNotificationBytes,
  ),
});

export type WorkflowSettings = z.infer<typeof workflowSettingsSchema>;

function numberDescriptor(
  field: IntegerField,
  extras: { description: string; default: number },
) {
  return {
    type: "number" as const,
    label: field.label,
    description: extras.description,
    default: extras.default,
    min: field.minimum,
    max: field.maximum,
  };
}

export const WORKFLOW_SETTING_DESCRIPTORS = {
  maxActiveRuns: numberDescriptor(INTEGER_FIELDS.maxActiveRuns, {
    description: "Concurrent workflow runs across the plugin (1-32).",
    default: 4,
  }),
  maxConcurrentAgents: numberDescriptor(INTEGER_FIELDS.maxConcurrentAgents, {
    description: "Agent calls that one workflow may run concurrently (1-64).",
    default: 8,
  }),
  maxAgentCalls: numberDescriptor(INTEGER_FIELDS.maxAgentCalls, {
    description: "Agent calls allowed during one workflow run (1-1000).",
    default: 100,
  }),
  totalRunTimeoutMs: numberDescriptor(INTEGER_FIELDS.totalRunTimeoutMs, {
    description:
      "Fail a workflow after this total duration in milliseconds (60000-604800000).",
    default: 86_400_000,
  }),
  retentionDays: numberDescriptor(INTEGER_FIELDS.retentionDays, {
    description: "Days to retain completed workflow data (1-3650).",
    default: 7,
  }),
  maxNotificationBytes: numberDescriptor(INTEGER_FIELDS.maxNotificationBytes, {
    description: "Maximum UTF-8 size of a completion notification (1024-262144).",
    default: 16_384,
  }),
} as const satisfies PluginSettingDescriptors;

export const DEFAULT_WORKFLOW_SETTINGS: Readonly<WorkflowSettings> =
  Object.freeze({
    maxActiveRuns: 4,
    maxConcurrentAgents: 8,
    maxAgentCalls: 100,
    totalRunTimeoutMs: 24 * 60 * 60 * 1_000,
    retentionDays: 7,
    maxNotificationBytes: 16 * 1_024,
  });

export function validateWorkflowSettings(
  values: Readonly<WorkflowSettings>,
): WorkflowSettings {
  return Object.freeze(workflowSettingsSchema.parse(values));
}

function coerceWorkflowSettings(
  values: Record<string, PluginSettingValue | undefined>,
): WorkflowSettings {
  return validateWorkflowSettings({
    maxActiveRuns:
      typeof values.maxActiveRuns === "number"
        ? values.maxActiveRuns
        : DEFAULT_WORKFLOW_SETTINGS.maxActiveRuns,
    maxConcurrentAgents:
      typeof values.maxConcurrentAgents === "number"
        ? values.maxConcurrentAgents
        : DEFAULT_WORKFLOW_SETTINGS.maxConcurrentAgents,
    maxAgentCalls:
      typeof values.maxAgentCalls === "number"
        ? values.maxAgentCalls
        : DEFAULT_WORKFLOW_SETTINGS.maxAgentCalls,
    totalRunTimeoutMs:
      typeof values.totalRunTimeoutMs === "number"
        ? values.totalRunTimeoutMs
        : DEFAULT_WORKFLOW_SETTINGS.totalRunTimeoutMs,
    retentionDays:
      typeof values.retentionDays === "number"
        ? values.retentionDays
        : DEFAULT_WORKFLOW_SETTINGS.retentionDays,
    maxNotificationBytes:
      typeof values.maxNotificationBytes === "number"
        ? values.maxNotificationBytes
        : DEFAULT_WORKFLOW_SETTINGS.maxNotificationBytes,
  });
}

const LEGACY_STORED_SETTING_KEYS = new Set(["workerStallTimeoutMs"]);

export function parseStoredWorkflowSettings(value: unknown): WorkflowSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Workflow settings snapshot must be an object");
  }
  const object = value as Record<string, unknown>;
  const expected = Object.keys(INTEGER_FIELDS);
  const actual = Object.keys(object);
  if (
    expected.some((key) => !Object.hasOwn(object, key)) ||
    actual.some(
      (key) =>
        !Object.hasOwn(INTEGER_FIELDS, key) &&
        !LEGACY_STORED_SETTING_KEYS.has(key),
    )
  ) {
    throw new Error("Workflow settings snapshot has unexpected fields");
  }
  const stored = Object.fromEntries(
    expected.map((key) => {
      const value = object[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new Error(`Workflow settings snapshot.${key} must be an integer`);
      }
      return [key, value];
    }),
  ) as WorkflowSettings;
  return validateWorkflowSettings(stored);
}

interface WorkflowSettingsHandle {
  get(): Promise<WorkflowSettings>;
  onChange(
    listener: (next: WorkflowSettings, previous: WorkflowSettings) => void,
    onInvalid?: (error: Error) => void,
  ): void;
}

export function registerWorkflowSettings(
  zcc: Pick<ZccPluginApi, "settings">,
): WorkflowSettingsHandle {
  const handle = zcc.settings.define(WORKFLOW_SETTING_DESCRIPTORS);
  let lastValid = DEFAULT_WORKFLOW_SETTINGS;
  return {
    async get() {
      const validated = coerceWorkflowSettings(await handle.get());
      lastValid = validated;
      return validated;
    },
    onChange(listener, onInvalid) {
      handle.onChange((next) => {
        try {
          const validatedNext = coerceWorkflowSettings(next);
          const parsedPrevious = lastValid;
          lastValid = validatedNext;
          listener(validatedNext, parsedPrevious);
        } catch (error) {
          onInvalid?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
    },
  };
}
