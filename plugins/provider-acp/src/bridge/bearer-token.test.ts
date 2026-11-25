import { describe, expect, it } from "vitest";
import { LINEAR_TIME_BUDGET_MS, allStrings } from "@zana-ai/zcc-domain/linear-time-testing";
import { parseBearerToken } from "./bearer-token.js";

describe("parseBearerToken", () => {
  it("extracts the token case-insensitively", () => {
    expect(parseBearerToken("Bearer abc")).toBe("abc");
    expect(parseBearerToken("bEaReR   abc def")).toBe("abc def");
    expect(parseBearerToken("Bearer\tabc")).toBe("abc");
  });

  it("rejects missing, malformed, empty and multi-line values", () => {
    expect(parseBearerToken(undefined)).toBeUndefined();
    expect(parseBearerToken("")).toBeUndefined();
    expect(parseBearerToken("Bearer")).toBeUndefined();
    expect(parseBearerToken("Bearerabc")).toBeUndefined();
    expect(parseBearerToken("Basic abc")).toBeUndefined();
    expect(parseBearerToken("Bearer    ")).toBeUndefined();
    expect(parseBearerToken("Bearer abc\ndef")).toBeUndefined();
  });

  it("matches the regex it replaced wherever the token is non-blank", () => {
    const mismatches: string[] = [];
    for (const input of allStrings(["Bearer", " ", "x", "\n", "\t"], 6)) {
      const old = /^Bearer\s+(.+)$/i.exec(input)?.[1];
      // The old regex handed trailing blanks to a whitespace-only "token"; a
      // blank token never equals the real one, so that case is not compared.
      if (old !== undefined && old.trim() === "") continue;
      if (parseBearerToken(input) !== old) mismatches.push(input);
    }
    expect(mismatches).toEqual([]);
  });

  it("is linear on a long whitespace run followed by a line break", () => {
    // The old regex backtracked quadratically on this shape.
    const input = `Bearer${" ".repeat(100_000)}\n`;
    const start = performance.now();
    expect(parseBearerToken(input)).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(LINEAR_TIME_BUDGET_MS);
  });
});
