import { describe, expect, it } from "vitest";
import { isFsErrorWithCode } from "./fs-errors.js";
import {
  assertStorageEntry,
  insideRoot,
  isStorageEntry,
  isThreadEntry,
  isTrashEntry,
  trashNameFor,
} from "./storage-entry.js";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("storage entry names", () => {
  it("accepts only thread-id directories and this plugin's own trash names", () => {
    expect(isThreadEntry(ID)).toBe(true);
    expect(isThreadEntry(ID.toUpperCase())).toBe(true);
    expect(isTrashEntry(`.zcc-trash-${ID}-${OTHER}`)).toBe(true);
    expect(isStorageEntry(ID)).toBe(true);
    expect(isStorageEntry(`.zcc-trash-${ID}-${OTHER}`)).toBe(true);
  });

  it("leaves every other daemon directory and every path trick alone", () => {
    for (const name of [
      "model-list",
      "provider-health",
      "",
      ".",
      "..",
      `${ID}/`,
      `../${ID}`,
      `${ID}/..`,
      `a/${ID}`,
      `${ID}\\x`,
      `${ID}\n`,
      `${ID}\0`,
      ID.slice(1),
      `${ID}-x`,
      ".zcc-trash-",
      `.zcc-trash-${ID}`,
      `.bb-trash-${ID}-${OTHER}`,
      `.zcc-trash-../x-${OTHER}`,
    ]) {
      expect(isStorageEntry(name), JSON.stringify(name)).toBe(false);
    }
  });

  it("refuses an unusable root or name before anything touches the disk", () => {
    expect(() => assertStorageEntry("/root", ID)).not.toThrow();
    expect(() => assertStorageEntry("relative/root", ID)).toThrow("Invalid storage entry");
    expect(() => assertStorageEntry("/root", "..")).toThrow("Invalid storage entry");
    expect(() => assertStorageEntry("/root", "model-list")).toThrow("Invalid storage entry");
  });

  it("builds a unique trash name that is itself a storage entry", () => {
    const first = trashNameFor(ID);
    const second = trashNameFor(ID);
    expect(first).not.toBe(second);
    expect(isTrashEntry(first)).toBe(true);
    expect(trashNameFor(ID, OTHER)).toBe(`.zcc-trash-${ID}-${OTHER}`);
    expect(() => trashNameFor("model-list")).toThrow("Invalid storage entry");
  });
});

describe("insideRoot", () => {
  it("is true only for paths strictly beneath the root", () => {
    expect(insideRoot("/data/x", "/data/x/a/b")).toBe(true);
    expect(insideRoot("/data/x", "/data/x")).toBe(false);
    expect(insideRoot("/data/x", "/data/xy/a")).toBe(false);
    expect(insideRoot("/data/x", "/data/x/../y")).toBe(false);
    expect(insideRoot("/data/x", "/data")).toBe(false);
    expect(insideRoot("/data/x", "relative/a")).toBe(false);
  });
});

describe("isFsErrorWithCode", () => {
  it("matches an error carrying the code and nothing else", () => {
    expect(isFsErrorWithCode(Object.assign(new Error("x"), { code: "ENOENT" }), "ENOENT")).toBe(true);
    expect(isFsErrorWithCode(Object.assign(new Error("x"), { code: "EACCES" }), "ENOENT")).toBe(false);
    expect(isFsErrorWithCode(new Error("x"), "ENOENT")).toBe(false);
    expect(isFsErrorWithCode({ code: "ENOENT" }, "ENOENT")).toBe(false);
    expect(isFsErrorWithCode(null, "ENOENT")).toBe(false);
  });
});
