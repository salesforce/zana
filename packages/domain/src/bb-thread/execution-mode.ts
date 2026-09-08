export type ExecutionModeKind = "plan" | "ask" | "execute" | "custom";
export type PortableWorkMode = "agent" | "plan";

export interface ClassifiedExecutionMode {
  id: string;
  label: string;
  kind: ExecutionModeKind;
}

export interface PortableWorkIntent {
  modes: PortableWorkMode[];
  planNativeValue: string | undefined;
  executeNativeValue: string | undefined;
  usesSlashPlan: boolean;
}

export interface ComposerModeEntry {
  id: string;
  label: string;
  kind: ExecutionModeKind;
  nativeValue: string | undefined;
  usesSlashPlan: boolean;
}

/**
 * Keep portable ACP modes available until optional native-role discovery is
 * explicitly enabled. Discovery may add provider-specific ask/custom modes.
 */
export function visibleAcpModeOptions(
  options: readonly { value: string; name?: string }[],
  nativeAgentDiscoveryEnabled: boolean,
): readonly { value: string; name?: string }[] {
  if (nativeAgentDiscoveryEnabled) return options;
  return options.filter((option) => option.value === "build" || option.value === "plan");
}

/**
 * Map a harness-native mode id/label onto a portable semantic kind.
 * Core never branches on a provider id — Cursor `plan`/`agent`/`ask` fall
 * out of this classifier like any other ACP session mode.
 */
export function classifyExecutionMode(
  id: string,
  name?: string,
): ExecutionModeKind {
  const token = id.trim().toLowerCase();
  const label = (name ?? "").trim().toLowerCase();
  if (token === "plan" || label === "plan") return "plan";
  if (token === "ask" || label === "ask") return "ask";
  if (
    token === "agent" ||
    token === "build" ||
    token === "execute" ||
    token === "code" ||
    label === "agent"
  ) {
    return "execute";
  }
  return "custom";
}

export function classifyExecutionModeOption(option: {
  value: string;
  name?: string;
}): ClassifiedExecutionMode {
  return {
    id: option.value,
    label: option.name?.trim() || option.value,
    kind: classifyExecutionMode(option.value, option.name),
  };
}

export function isPlanExecutionMode(
  id: string | null | undefined,
  name?: string,
): boolean {
  if (!id) return false;
  return classifyExecutionMode(id, name) === "plan";
}

/**
 * Project an ACP session-mode catalog onto Agent | Plan.
 * Ask and custom native roles are not offered; execute-kind (`agent`/`build`)
 * becomes Agent.
 */
export function portableWorkIntent(args: {
  acpModeOptions: readonly { value: string; name?: string }[];
  composerActions?: readonly string[];
}): PortableWorkIntent {
  const classified = args.acpModeOptions.map(classifyExecutionModeOption);
  const plan = classified.find((row) => row.kind === "plan");
  const execute = classified.find((row) => row.kind === "execute");
  const usesSlashPlan =
    plan === undefined && (args.composerActions ?? []).includes("plan");
  const modes: PortableWorkMode[] = ["agent"];
  if (plan !== undefined || usesSlashPlan) modes.push("plan");
  return {
    modes,
    planNativeValue: plan?.id,
    executeNativeValue: execute?.id,
    usesSlashPlan,
  };
}

/**
 * Build Modern composer's one mode menu. Portable Agent and Plan stay first;
 * native ask/custom modes follow without duplicating execute/plan entries.
 */
export function composerModeEntries(args: {
  acpModeOptions: readonly { value: string; name?: string }[];
  composerActions?: readonly string[];
}): ComposerModeEntry[] {
  const intent = portableWorkIntent(args);
  const entries: ComposerModeEntry[] = [
    {
      id: "agent",
      label: "Agent",
      kind: "execute",
      nativeValue: intent.executeNativeValue,
      usesSlashPlan: false,
    },
  ];
  if (intent.planNativeValue || intent.usesSlashPlan) {
    entries.push({
      id: "plan",
      label: "Plan",
      kind: "plan",
      nativeValue: intent.planNativeValue,
      usesSlashPlan: intent.usesSlashPlan,
    });
  }
  for (const option of args.acpModeOptions.map(classifyExecutionModeOption)) {
    if (option.kind !== "ask" && option.kind !== "custom") continue;
    entries.push({
      id: option.id,
      label: option.label,
      kind: option.kind,
      nativeValue: option.id,
      usesSlashPlan: false,
    });
  }
  return entries;
}

export function composerWorkModeFromNativeMode(
  nativeMode: string | null | undefined,
): PortableWorkMode {
  if (!nativeMode) return "agent";
  return classifyExecutionMode(nativeMode) === "plan" ? "plan" : "agent";
}

export function nativeModeForComposerWorkMode(
  mode: PortableWorkMode,
  intent: PortableWorkIntent,
): string | undefined {
  if (mode === "plan") return intent.planNativeValue;
  return intent.executeNativeValue;
}
