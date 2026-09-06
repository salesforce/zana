import { describe, expect, it } from "vitest";
import {
  BUILT_IN_ACP_LAUNCH_SPECS,
  BUILT_IN_ACP_MODEL_PICKER,
} from "./acp-launch-specs.js";

describe("BUILT_IN_ACP_LAUNCH_SPECS", () => {
  it("discovers Cursor models through the parameterized ACP picker, not --list-models", () => {
    expect(BUILT_IN_ACP_LAUNCH_SPECS["acp-cursor"]).not.toHaveProperty(
      "modelCli",
    );
    expect(BUILT_IN_ACP_MODEL_PICKER["acp-cursor"]).toEqual({
      acpDialect: "cursor",
      parameterizedModelPicker: true,
      primaryModels: [
        "default",
        "grok-4.6",
        "gpt-5.6-sol",
        "claude-opus-5",
        "claude-fable-5",
        "composer-2.5",
      ],
      reasoningProbePriorityModelIds: ["grok-4.6", "grok-4.5"],
    });
  });

  it("declares Cursor native skill roots without a model list CLI", () => {
    expect(BUILT_IN_ACP_LAUNCH_SPECS["acp-cursor"]).toMatchObject({
      displayName: "Cursor",
      command: "cursor-agent",
      args: ["acp"],
      env: {},
      nativeSkillRoots: {
        user: [
          ".cursor/skills",
          ".agents/skills",
          ".claude/skills",
          ".codex/skills",
        ],
        project: [
          ".cursor/skills",
          ".agents/skills",
          ".claude/skills",
          ".codex/skills",
        ],
      },
    });
  });

  it("declares OpenCode native skill roots without a model list CLI", () => {
    expect(BUILT_IN_ACP_LAUNCH_SPECS["acp-opencode"]).toEqual({
      displayName: "OpenCode",
      command: "opencode",
      args: ["acp"],
      env: {},
      nativeSkillRoots: {
        user: [".claude/skills", ".agents/skills"],
        project: [".opencode/skills", ".claude/skills", ".agents/skills"],
      },
    });
    expect(BUILT_IN_ACP_LAUNCH_SPECS["acp-opencode"]).not.toHaveProperty(
      "modelCli",
    );
    expect(BUILT_IN_ACP_MODEL_PICKER["acp-opencode"]).toBeUndefined();
  });

  it("covers every plugin-declared ACP provider and not Claude or Codex", () => {
    expect(Object.keys(BUILT_IN_ACP_LAUNCH_SPECS).sort()).toEqual([
      "acp-cursor",
      "acp-grok",
      "acp-hermes-agent",
      "acp-omp",
      "acp-opencode",
    ]);
    expect(BUILT_IN_ACP_LAUNCH_SPECS["claude-code"]).toBeUndefined();
    expect(BUILT_IN_ACP_LAUNCH_SPECS.codex).toBeUndefined();
  });

  it("launches Grok Build as `grok agent stdio` with its CLI model and permission flags", () => {
    expect(BUILT_IN_ACP_LAUNCH_SPECS["acp-grok"]).toMatchObject({
      displayName: "Grok Build",
      command: "grok",
      args: ["agent", "stdio"],
      modelCli: {
        listArgs: ["models"],
        selectFlag: "--model",
        primaryModels: ["grok-4.5", "grok-composer-2.5-fast"],
      },
      permissionCli: {
        full: ["--always-approve"],
        insertAfterArgs: 1,
      },
      reasoningCli: {
        flag: "--reasoning-effort",
        supportedLevels: ["low", "medium", "high"],
        defaultLevel: "high",
      },
    });
    expect(BUILT_IN_ACP_MODEL_PICKER["acp-grok"]).toEqual({ acpDialect: "grok" });
  });

  it("launches OMP and Hermes on their ACP subcommands", () => {
    expect(BUILT_IN_ACP_LAUNCH_SPECS["acp-omp"]).toMatchObject({
      command: "omp",
      args: ["acp"],
    });
    expect(BUILT_IN_ACP_LAUNCH_SPECS["acp-hermes-agent"]).toMatchObject({
      command: "hermes",
      args: ["acp"],
      nativeReasoning: {
        configId: "reasoning_effort",
        defaultLevel: "medium",
      },
    });
    expect(BUILT_IN_ACP_MODEL_PICKER["acp-omp"]).toEqual({ acpDialect: "omp" });
  });
});
