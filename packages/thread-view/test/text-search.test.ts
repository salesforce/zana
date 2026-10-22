import { describe, expect, it } from "vitest";
import {
  THREAD_SEARCH_QUERY_MAX,
  countThreadSearchMatches,
  threadSearchPattern,
  threadSearchRanges,
} from "../src/index.js";

describe("thread search matching", () => {
  it("has no pattern for an empty query", () => {
    expect(threadSearchPattern("")).toBeNull();
    expect(threadSearchPattern("   ")).toBeNull();
  });

  it("matches literally, case-insensitively and without overlaps", () => {
    const pattern = threadSearchPattern("  A.b ")!;
    expect(threadSearchRanges("a.b AXB A.B a.b", pattern)).toEqual([[0, 3], [8, 11], [12, 15]]);
    expect(countThreadSearchMatches("aaaa", threadSearchPattern("aa")!)).toBe(2);
    expect(countThreadSearchMatches("(x)[y]{z}$^|\\", threadSearchPattern("(x)[y]{z}$^|\\")!)).toBe(1);
    expect(countThreadSearchMatches("nothing here", pattern)).toBe(0);
  });

  it("keeps offsets in the original text when case folding changes length", () => {
    const text = "İstanbul and istanbul";
    expect(threadSearchRanges(text, threadSearchPattern("istanbul")!)).toEqual([[13, 21]]);
    expect(threadSearchRanges("ÉCOLE école", threadSearchPattern("école")!)).toEqual([[0, 5], [6, 11]]);
  });

  it("can be reused across texts", () => {
    const pattern = threadSearchPattern("x")!;
    expect(countThreadSearchMatches("x x", pattern)).toBe(2);
    expect(countThreadSearchMatches("xx", pattern)).toBe(2);
  });

  it("caps the query length", () => {
    const long = "a".repeat(THREAD_SEARCH_QUERY_MAX + 50);
    expect(countThreadSearchMatches("a".repeat(THREAD_SEARCH_QUERY_MAX), threadSearchPattern(long)!)).toBe(1);
  });
});
