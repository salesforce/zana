export type ToolPolicyClassification = 'true' | 'false' | 'unknown';

export type ToolPolicyInventorySource = 'valid-empty' | 'loaded' | 'retained-after-error';

export type ToolPolicyInventoryEntry = {
  pluginId: string;
  enabled: boolean;
  hasServer: boolean;
  toolPolicy: ToolPolicyClassification;
};

export type ToolPolicyInventorySnapshot = {
  revision: number;
  source: ToolPolicyInventorySource;
  entries: readonly ToolPolicyInventoryEntry[];
};

export type ToolPolicyRequiredGeneration = {
  pluginId: string;
  toolPolicy: Extract<ToolPolicyClassification, 'true' | 'unknown'>;
  generationId: string | null;
};

export type ToolPolicyDecisionStamp = {
  revision: number;
  required: readonly ToolPolicyRequiredGeneration[];
};

export const TOOL_POLICY_NOT_READY_REASON = 'plugin tool policy not ready';
export const TOOL_POLICY_STAMP_CHANGED_REASON = 'plugin tool policy changed';
export const TOOL_POLICY_INVENTORY_UNAVAILABLE_REASON = 'plugin tool policy inventory unavailable';

export type ToolPolicyDeclared = boolean | undefined;

export function classifyDeclaredToolPolicy(input: {
  declared: ToolPolicyDeclared;
  hasServer: boolean;
}): ToolPolicyClassification {
  if (input.declared === true) return 'true';
  if (input.declared === false) return 'false';
  return input.hasServer ? 'unknown' : 'false';
}

export function persistKnownTrueMonotonically(input: {
  existing: ToolPolicyClassification | undefined;
  next: ToolPolicyClassification;
  enabled: boolean;
}): ToolPolicyClassification {
  if (input.existing === 'true' && input.enabled && input.next !== 'true') {
    return 'true';
  }
  return input.next;
}

export function resolveActivatedToolPolicy(input: {
  existing: ToolPolicyClassification | undefined;
  declared: ToolPolicyDeclared;
  hasServer: boolean;
  registeredHandler: boolean;
  enabled: boolean;
}): ToolPolicyClassification {
  const next: ToolPolicyClassification = input.registeredHandler
    ? 'true'
    : input.declared === true
      ? 'true'
      : 'false';
  return persistKnownTrueMonotonically({
    existing: input.existing,
    next,
    enabled: input.enabled
  });
}

export function createToolPolicyInventoryState(initial?: ToolPolicyInventorySnapshot) {
  let revision = initial?.revision ?? 0;
  let snapshot: ToolPolicyInventorySnapshot = initial
    ? freezeSnapshot(initial)
    : freezeSnapshot({
        revision: 0,
        source: 'valid-empty',
        entries: []
      });

  return {
    snapshot(): ToolPolicyInventorySnapshot {
      return snapshot;
    },
    replace(next: Omit<ToolPolicyInventorySnapshot, 'revision'>): ToolPolicyInventorySnapshot {
      revision += 1;
      snapshot = freezeSnapshot({ ...next, revision });
      return snapshot;
    },
    retainAfterError(reason: string): { snapshot: ToolPolicyInventorySnapshot; reason: string } {
      revision += 1;
      snapshot = freezeSnapshot({
        revision,
        source: 'retained-after-error',
        entries: snapshot.entries
      });
      return { snapshot, reason };
    }
  };
}

export function requiredPolicyPluginIds(snapshot: ToolPolicyInventorySnapshot): string[] {
  return snapshot.entries
    .filter((entry) => entry.enabled && (entry.toolPolicy === 'true' || entry.toolPolicy === 'unknown'))
    .map((entry) => entry.pluginId);
}

export function captureToolPolicyStamp(
  snapshot: ToolPolicyInventorySnapshot,
  generationIds: ReadonlyMap<string, string | null>
): ToolPolicyDecisionStamp {
  return Object.freeze({
    revision: snapshot.revision,
    required: Object.freeze(
      requiredPolicyPluginIds(snapshot).map((pluginId) => {
        const entry = snapshot.entries.find((item) => item.pluginId === pluginId)!;
        return Object.freeze({
          pluginId,
          toolPolicy: entry.toolPolicy as Extract<ToolPolicyClassification, 'true' | 'unknown'>,
          generationId: generationIds.get(pluginId) ?? null
        });
      })
    )
  });
}

export function sameToolPolicyStamp(left: ToolPolicyDecisionStamp, right: ToolPolicyDecisionStamp): boolean {
  if (left.revision !== right.revision || left.required.length !== right.required.length) return false;
  return left.required.every((entry, index) => {
    const other = right.required[index];
    return (
      other.pluginId === entry.pluginId
      && other.toolPolicy === entry.toolPolicy
      && other.generationId === entry.generationId
    );
  });
}

function freezeSnapshot(snapshot: ToolPolicyInventorySnapshot): ToolPolicyInventorySnapshot {
  return Object.freeze({
    revision: snapshot.revision,
    source: snapshot.source,
    entries: Object.freeze(snapshot.entries.map((entry) => Object.freeze({ ...entry })))
  });
}
