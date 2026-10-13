import {
  buildShellEnvOverrides,
  type DynamicTool,
  type InstructionMode,
  type ReasoningLevel,
} from "@zana-ai/zcc-plugin-sdk/provider-bridge";

type PiReasoningLevel = "off" | "low" | "medium" | "high" | "xhigh" | "max";

function toPiThinkingLevel(
  reasoningLevel: ReasoningLevel | undefined,
): PiReasoningLevel | undefined {
  switch (reasoningLevel) {
    case "none":
      return "off";
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return reasoningLevel;
    case "ultracode":
    case "ultra":
    case undefined:
      return undefined;
  }
}

interface PiSessionOptions {
  model?: string | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  instructions?: string | undefined;
  envVars?: Record<string, string> | undefined;
  providerOptions?: Record<string, unknown> | undefined;
}

// The plugin setting defaults on; only an explicit opt-out turns it off.
function trustsSystemCertificates(options: PiSessionOptions): boolean {
  return options.providerOptions?.trustSystemCertificates !== false;
}

interface BuildPiSessionParamsArgs {
  threadId: string;
  cwd: string;
  options: PiSessionOptions;
  instructionMode: InstructionMode;
  dynamicTools?: readonly DynamicTool[] | undefined;
  additionalSkillPaths?: readonly string[] | undefined;
}

export interface PiSessionParams {
  additionalSkillPaths?: readonly string[];
  appendSystemPrompt?: string;
  baseInstructions?: string;
  cwd: string;
  dynamicTools?: readonly DynamicTool[];
  model?: string;
  shellEnvOverrides: Record<string, string>;
  thinkingLevel?: PiReasoningLevel;
  trustSystemCertificates: boolean;
}

export interface PiTurnOptions {
  model: string | undefined;
  thinkingLevel: PiReasoningLevel | undefined;
  trustSystemCertificates: boolean;
}

export function buildPiTurnOptions(options: PiSessionOptions): PiTurnOptions {
  return {
    model: options.model && options.model !== "default" ? options.model : undefined,
    thinkingLevel: toPiThinkingLevel(options.reasoningLevel),
    trustSystemCertificates: trustsSystemCertificates(options),
  };
}

export function buildPiSessionParams(
  args: BuildPiSessionParamsArgs,
): PiSessionParams {
  const instructions = args.options.instructions?.trim();
  const thinkingLevel = toPiThinkingLevel(args.options.reasoningLevel);
  const model = buildPiTurnOptions(args.options).model;
  return {
    cwd: args.cwd,
    shellEnvOverrides: {
      ZCC_THREAD_ID: args.threadId,
      ...buildShellEnvOverrides(args.options.envVars),
    },
    trustSystemCertificates: trustsSystemCertificates(args.options),
    ...(instructions
      ? args.instructionMode === "replace"
        ? { baseInstructions: instructions }
        : { appendSystemPrompt: instructions }
      : {}),
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(args.dynamicTools && args.dynamicTools.length > 0
      ? { dynamicTools: args.dynamicTools }
      : {}),
    ...(args.additionalSkillPaths && args.additionalSkillPaths.length > 0
      ? { additionalSkillPaths: [...args.additionalSkillPaths] }
      : {}),
  };
}
