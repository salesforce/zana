import { describe, expect, it } from "vitest";
import { rewriteCodexFileCitations } from "./file-citations.js";

describe("rewriteCodexFileCitations", () => {
  it("leaves text without citations untouched", () => {
    const text = "plain :other{path=\"/x\"} text";
    expect(rewriteCodexFileCitations(text)).toBe(text);
  });

  it("rewrites an output citation to a Markdown link named after the file", () => {
    expect(
      rewriteCodexFileCitations(
        'See :codex-file-citation{path="/Users/me/out/report.pdf" purpose="output" artifact_kind="pdf"} now.',
      ),
    ).toBe("See [report.pdf](/Users/me/out/report.pdf) now.");
  });

  it("adds page, sheet and range detail to the label", () => {
    expect(
      rewriteCodexFileCitations(
        ':codex-file-citation{path="/a/deck.pdf" page_number="3"} :codex-file-citation{path="/a/book.xlsx" sheet="Q1" range="A1:B9"}',
      ),
    ).toBe("[deck.pdf (page 3)](/a/deck.pdf) [book.xlsx (Q1, A1:B9)](/a/book.xlsx)");
  });

  it("wraps paths with spaces or parentheses and escapes label brackets", () => {
    expect(
      rewriteCodexFileCitations(':codex-file-citation{path="/a/My [v2] (final).md"}'),
    ).toBe("[My \\[v2\\] (final).md](</a/My [v2] (final).md>)");
  });

  it("unescapes quoted attribute values", () => {
    expect(rewriteCodexFileCitations(':codex-file-citation{path="/a/say-\\"hi\\".txt"}')).toBe(
      '[say-"hi".txt](/a/say-"hi".txt)',
    );
  });

  it("keeps citations without a path verbatim", () => {
    const text = ':codex-file-citation{purpose="output"} and :codex-file-citation{path="  "}';
    expect(rewriteCodexFileCitations(text)).toBe(text);
  });
});
