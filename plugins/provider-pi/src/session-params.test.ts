import { describe, expect, it } from "vitest";
import { buildPiSessionParams, buildPiTurnOptions } from "./session-params.js";

describe("buildPiSessionParams", () => {
  it("injects the bb thread id into the shell env and drops invalid keys", () => {
    expect(
      buildPiSessionParams({
        threadId: "bb-thread-1",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        options: {
          envVars: {
            "BAD.KEY": "ignored",
            TEST_VAR: "123",
          },
        },
      }).shellEnvOverrides,
    ).toEqual({
      ZCC_THREAD_ID: "bb-thread-1",
      TEST_VAR: "123",
    });
  });

  it("passes contributed variables into Pi session parameters", () => {
    expect(
      buildPiSessionParams({
        threadId: "bb-thread-1",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        options: {
          envVars: {
            POOL_E2E_URL: "http://127.0.0.1:3334/plugins/pool-e2e/auth",
          },
        },
      }).shellEnvOverrides,
    ).toMatchObject({
      POOL_E2E_URL: "http://127.0.0.1:3334/plugins/pool-e2e/auth",
    });
  });

  it("maps the bb reasoning ladder onto Pi thinking levels", () => {
    const params = (reasoningLevel: "none" | "high" | "ultracode") =>
      buildPiSessionParams({
        threadId: "bb-thread-1",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        options: { reasoningLevel },
      });

    expect(params("none").thinkingLevel).toBe("off");
    expect(params("high").thinkingLevel).toBe("high");
    expect(params("ultracode")).not.toHaveProperty("thinkingLevel");
  });

  it("trusts system certificates unless the provider options opt out", () => {
    const params = (providerOptions?: Record<string, unknown>) =>
      buildPiSessionParams({
        threadId: "bb-thread-1",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        options: { providerOptions },
      }).trustSystemCertificates;

    expect(params()).toBe(true);
    expect(params({ trustSystemCertificates: true })).toBe(true);
    expect(params({ trustSystemCertificates: false })).toBe(false);
    expect(
      buildPiTurnOptions({ providerOptions: { trustSystemCertificates: false } })
        .trustSystemCertificates,
    ).toBe(false);
    expect(buildPiTurnOptions({}).trustSystemCertificates).toBe(true);
  });

  it("routes instructions by mode", () => {
    const withMode = (instructionMode: "append" | "replace") =>
      buildPiSessionParams({
        threadId: "bb-thread-1",
        cwd: "/tmp/worktree",
        instructionMode,
        options: { instructions: "  Focus on the failing tests first.  " },
      });

    expect(withMode("append")).toMatchObject({
      appendSystemPrompt: "Focus on the failing tests first.",
    });
    expect(withMode("append")).not.toHaveProperty("baseInstructions");
    expect(withMode("replace")).toMatchObject({
      baseInstructions: "Focus on the failing tests first.",
    });
    expect(withMode("replace")).not.toHaveProperty("appendSystemPrompt");
  });
});
