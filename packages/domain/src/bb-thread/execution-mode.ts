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
