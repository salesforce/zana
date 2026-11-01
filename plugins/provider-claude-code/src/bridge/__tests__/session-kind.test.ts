import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeClaudeSessionKind,
  resolveBridgeDataDir,
} from "../session-kind.js";

describe("normalizeClaudeSessionKind", () => {
  it.each([undefined, null, "interactive", "bogus", 7])(
    "defaults %s to interactive",
    (requested) => {
      expect(
        normalizeClaudeSessionKind({ requested }),
      ).toEqual({ kind: "interactive", admission: "default-interactive" });
    },
  );

  it("admits automated", () => {
    expect(
      normalizeClaudeSessionKind({ requested: "automated" }),
    ).toEqual({ kind: "automated", admission: "applied" });
  });
});

describe("resolveBridgeDataDir", () => {
  it("honours ZCC_DATA_DIR, then ZCC_CENTER_DIR, then ~/.zcc", () => {
    expect(resolveBridgeDataDir({ ZCC_DATA_DIR: "/a", ZCC_CENTER_DIR: "/b" }, "/h")).toBe("/a");
    expect(resolveBridgeDataDir({ ZCC_CENTER_DIR: " /b " }, "/h")).toBe("/b");
    expect(resolveBridgeDataDir({}, "/h")).toBe(join("/h", ".zcc"));
  });
});
