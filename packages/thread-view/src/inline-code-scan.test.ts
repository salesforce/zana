import { describe, expect, it } from "vitest";
import { LINEAR_TIME_BUDGET_MS, allStrings } from "@zana-ai/zcc-domain/linear-time-testing";
import { scanInlineCode } from "./inline-code-scan.js";

// The regex this scanner replaced; kept as the oracle.
const REFERENCE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/gu;

function reference(text: string) {
  return [...text.matchAll(REFERENCE)].map((m) => ({
    index: m.index,
    length: m[0].length,
    content: m[2]!,
  }));
}

describe("scanInlineCode", () => {
  it("finds simple and multi-backtick spans", () => {
    expect(scanInlineCode("a `b` c")).toEqual([{ index: 2, length: 3, content: "b" }]);
    expect(scanInlineCode("``a`b`` x `c`")).toEqual([
      { index: 0, length: 7, content: "a`b" },
      { index: 10, length: 3, content: "c" },
    ]);
  });

  it("falls back to a shorter opener when the full run never closes", () => {
    expect(scanInlineCode("```a``")).toEqual(reference("```a``"));
    expect(scanInlineCode("```a``")).toEqual([{ index: 1, length: 5, content: "a" }]);
  });

  it("returns nothing for unclosed or empty-content input", () => {
    expect(scanInlineCode("")).toEqual([]);
    expect(scanInlineCode("`abc")).toEqual([]);
    expect(scanInlineCode("``")).toEqual([]);
    expect(scanInlineCode("`` ``")).toEqual(reference("`` ``"));
  });

  it("matches the regex it replaced on every short string", () => {
    const mismatches: string[] = [];
    for (const input of allStrings(["`", "a", "\n"], 11)) {
      if (JSON.stringify(scanInlineCode(input)) !== JSON.stringify(reference(input))) {
        mismatches.push(input);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("is linear on a long run of backticks", () => {
    // The old regex retried every start and shorter opener: quadratic here.
    for (const input of ["`".repeat(100_000), "`a".repeat(50_000), "`".repeat(50_000) + "x"]) {
      const start = performance.now();
      scanInlineCode(input);
      expect(performance.now() - start).toBeLessThan(LINEAR_TIME_BUDGET_MS);
    }
  });
});
