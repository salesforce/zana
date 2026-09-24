import { describe, expect, it } from "vitest";
import {
  MissingClaudeCliError,
  translateMissingClaudeCliCatalogError,
  translateMissingClaudeCliError,
} from "./missing-cli-error.js";

describe("missing Claude CLI translation", () => {
  it("keeps session-start guidance as a plain Error", () => {
    const cause = new Error("Native CLI binary for darwin-arm64 not found at /tmp/cli");
    const translated = translateMissingClaudeCliError(cause);
    expect(translated).toBeInstanceOf(Error);
    expect(translated).not.toBeInstanceOf(MissingClaudeCliError);
    expect((translated as Error).message).toContain("could not find the Claude Code CLI");
  });

  it("marks catalog failures with MissingClaudeCliError", () => {
    const cause = new Error("Native CLI binary for darwin-arm64 not found at /tmp/cli");
    const translated = translateMissingClaudeCliCatalogError(cause);
    expect(translated).toBeInstanceOf(MissingClaudeCliError);
    expect((translated as Error).message).toContain("could not find the Claude Code CLI");
  });

  it("leaves unrelated catalog failures unmarked", () => {
    const cause = new Error("Claude SDK stream closed");
    expect(translateMissingClaudeCliCatalogError(cause)).toBe(cause);
  });
});
