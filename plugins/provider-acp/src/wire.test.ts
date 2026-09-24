import { describe, expect, it } from "vitest";
import { findAcpModeConfigOption } from "./bridge/model-catalog.js";
import {
  acpInitializeResultSchema,
  acpSessionForkResultSchema,
  acpSessionNewResultSchema,
} from "./wire.js";

describe("acpInitializeResultSchema", () => {
  it("exposes the unstable session fork capability", () => {
    const parsed = acpInitializeResultSchema.parse({
      protocolVersion: 1,
      agentCapabilities: {
        sessionCapabilities: { fork: {} },
      },
    });

    expect(parsed.agentCapabilities?.sessionCapabilities?.fork).toEqual({});
  });
});

describe("acpSessionNewResultSchema", () => {
  // pi-acp serializes absent optional strings as explicit `null` instead of
  // omitting them. Before this was accepted, every pi-acp thread failed to
  // start with "ACP agent returned an unexpected session/new result".
  it("accepts explicit null for optional model and config-option strings", () => {
    const parsed = acpSessionNewResultSchema.safeParse({
      sessionId: "session-1",
      models: {
        currentModelId: "openai-codex/gpt-5.5",
        availableModels: [
          {
            modelId: "openai-codex/gpt-5.5",
            name: "openai-codex/GPT-5.5",
            description: null,
          },
        ],
      },
      configOptions: [
        {
          type: "select",
          id: "model",
          category: "model",
          name: "Model",
          description: "Select the model for this session",
          currentValue: "openai-codex/gpt-5.5",
          options: [
            {
              value: "openai-codex/gpt-5.5",
              name: "openai-codex/GPT-5.5",
              description: null,
            },
          ],
        },
        {
          type: "select",
          id: "thought_level",
          category: null,
          name: "Thinking",
          currentValue: "medium",
          options: [{ value: "medium", name: null }],
        },
      ],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(
      parsed.data.models?.availableModels?.[0].description,
    ).toBeUndefined();
    expect(parsed.data.configOptions?.[0].options?.[0].name).toBe(
      "openai-codex/GPT-5.5",
    );
    expect(parsed.data.configOptions?.[1].category).toBeUndefined();
    expect(parsed.data.configOptions?.[1].options?.[0].name).toBeUndefined();
  });

  it("flattens grouped select options into their values", () => {
    const parsed = acpSessionNewResultSchema.safeParse({
      sessionId: "session-1",
      configOptions: [
        {
          type: "select",
          id: "model",
          category: "model",
          name: "Model",
          currentValue: "model-a",
          options: [
            {
              group: "vendor-1",
              name: "Vendor 1",
              options: [{ value: "model-a", name: "Model A" }],
            },
            {
              group: "vendor-2",
              name: "Vendor 2",
              options: [
                { value: "model-b", name: "Model B" },
                { value: "model-c", name: "Model C" },
              ],
            },
          ],
        },
        {
          type: "select",
          id: "reasoning_effort",
          category: "thought_level",
          name: "Reasoning effort",
          currentValue: "high",
          options: [
            {
              group: "levels",
              name: "Levels",
              options: [
                { value: "low", name: "Low" },
                { value: "high", name: "High" },
              ],
            },
          ],
        },
        {
          type: "select",
          id: "mode",
          category: "mode",
          name: "Mode",
          currentValue: "plan",
          options: [
            {
              group: "work",
              name: "Work",
              options: [
                { value: "agent", name: "Agent" },
                { value: "plan", name: "Plan" },
              ],
            },
          ],
        },
      ],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(
      parsed.data.configOptions?.[0].options?.map((option) => option.value),
    ).toEqual(["model-a", "model-b", "model-c"]);
    expect(
      parsed.data.configOptions?.[1].options?.map((option) => option.value),
    ).toEqual(["low", "high"]);
    expect(
      parsed.data.configOptions?.[2].options?.map((option) => option.value),
    ).toEqual(["agent", "plan"]);
    expect(findAcpModeConfigOption(parsed.data.configOptions)).toMatchObject({
      category: "mode",
      currentValue: "plan",
    });
  });
});

describe("acpSessionForkResultSchema", () => {
  it("accepts the SDK's nullable configOptions field", () => {
    const parsed = acpSessionForkResultSchema.parse({
      sessionId: "forked-session",
      configOptions: null,
    });

    expect(parsed).toEqual({
      sessionId: "forked-session",
      configOptions: undefined,
    });
  });
});
