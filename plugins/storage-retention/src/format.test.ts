import { describe, expect, it } from "vitest";
import { ago, bytes, duration, isRelaxation, message, plural } from "./format.js";

const MINUTE = 60_000;

describe("bytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [10 * 1024 * 1024, "10 MB"],
    [3.25 * 1024 ** 3, "3.3 GB"],
    [2 * 1024 ** 4, "2 TB"],
    [5000 * 1024 ** 4, "5000 TB"],
  ])("formats %d as %s", (value, text) => {
    expect(bytes(value)).toBe(text);
  });
});

describe("ago", () => {
  const now = 1_700_000_000_000;
  it.each([
    [now - 10_000, "just now"],
    [now - 5 * MINUTE, "5m ago"],
    [now - 3 * 60 * MINUTE, "3h ago"],
    [now - 50 * 60 * MINUTE, "2d ago"],
    [now + 5 * MINUTE, "just now"],
  ])("describes %d as %s", (time, text) => {
    expect(ago(time, now)).toBe(text);
  });
});

describe("duration", () => {
  it.each([
    [1, "1 day"],
    [3, "3 days"],
    [7, "1 week"],
    [14, "2 weeks"],
    [30, "30 days"],
    [90, "90 days"],
    [365, "1 year"],
    [730, "2 years"],
  ])("names %d days as %s", (days, text) => {
    expect(duration(days)).toBe(text);
  });
});

describe("plural", () => {
  it("counts with the right noun", () => {
    expect(plural(1, "thread")).toBe("1 thread");
    expect(plural(0, "thread")).toBe("0 threads");
    expect(plural(1234, "file")).toBe("1,234 files");
    expect(plural(2, "entry", "entries")).toBe("2 entries");
  });
});

describe("message", () => {
  it("reads errors and anything else", () => {
    expect(message(new Error("boom"))).toBe("boom");
    expect(message("plain")).toBe("plain");
    expect(message(404)).toBe("404");
  });
});

describe("isRelaxation", () => {
  const off = { archiveAfterDays: null, clearAfterDays: null, clearStorageOnArchive: false };

  it("treats a change that can only keep more as safe to save without review", () => {
    expect(isRelaxation({ ...off, archiveAfterDays: 30 }, off)).toBe(true);
    expect(isRelaxation({ ...off, archiveAfterDays: 30 }, { ...off, archiveAfterDays: 60 })).toBe(true);
    expect(isRelaxation({ ...off, clearAfterDays: 30 }, { ...off, clearAfterDays: null })).toBe(true);
    expect(isRelaxation({ ...off, clearStorageOnArchive: true }, off)).toBe(true);
    expect(isRelaxation(off, off)).toBe(true);
  });

  it("asks for review when anything gets more aggressive", () => {
    expect(isRelaxation(off, { ...off, archiveAfterDays: 30 })).toBe(false);
    expect(isRelaxation({ ...off, archiveAfterDays: 30 }, { ...off, archiveAfterDays: 7 })).toBe(false);
    expect(isRelaxation(off, { ...off, clearAfterDays: 90 })).toBe(false);
    expect(isRelaxation(off, { ...off, clearStorageOnArchive: true })).toBe(false);
    expect(
      isRelaxation(
        { ...off, archiveAfterDays: 30, clearStorageOnArchive: true },
        { ...off, archiveAfterDays: null, clearAfterDays: 7, clearStorageOnArchive: true },
      ),
    ).toBe(false);
  });
});
