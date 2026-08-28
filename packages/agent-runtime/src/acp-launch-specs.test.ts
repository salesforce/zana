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
});
