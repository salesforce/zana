import { describe, expect, it } from "vitest";
import {
  THREAD_SEARCH_QUERY_MAX,
  countThreadSearchMatches,
  threadSearchMarkdownText,
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

describe("threadSearchMarkdownText", () => {
  const visible = (markdown: string) => threadSearchMarkdownText(markdown).trim();

  it("keeps link labels and drops link targets, images and reference definitions", () => {
    expect(visible("See [foo](http://foo.com) and [bar][1].\n\n[1]: http://bar.com")).toBe("See foo and bar.");
    expect(visible("![a foo picture](foo.png) <https://foo.com>")).toBe("https://foo.com");
    // One visible "foo", as the reader sees it.
    expect(countThreadSearchMatches(threadSearchMarkdownText("[foo](http://foo.com)"), threadSearchPattern("foo")!)).toBe(1);
  });

  it("drops emphasis, heading, quote, list, rule and table syntax", () => {
    expect(visible("# Title\n> **bold** and *it* and _it_ ~~gone~~")).toBe("Title\nbold and it and it gone");
    expect(visible("- [x] done\n1. first\n* star\n\n---")).toBe("done\nfirst\nstar");
    expect(visible("| a | b |\n| --- | :-: |\n| 1 | 2 |")).toBe("| a | b |\n\n| 1 | 2 |");
    expect(visible("snake_case_name and 2*3*4 and \\*literal\\*")).toBe("snake_case_name and 2*3*4 and *literal*");
  });

  it("keeps code literally, inline and fenced", () => {
    expect(visible("run `a*b*c` or ``x ` y``")).toBe("run a*b*c or x ` y");
    expect(visible("before\n```ts\nconst **x** = [y](z);\n```\nafter **b**")).toBe("before\nconst **x** = [y](z);\nafter b");
    expect(visible("~~~\n```\nstill code\n~~~")).toBe("```\nstill code");
    expect(visible("```\nunclosed [a](b)")).toBe("unclosed [a](b)");
  });
});
