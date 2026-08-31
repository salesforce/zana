import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectTestPluginApp } from "@zana-ai/zcc-plugin-sdk/testing/app";
import { createFakePluginHost } from "@zana-ai/zcc-plugin-sdk/testing";
import { derivePluginId } from "@zana-ai/zcc-domain";
import app from "../app.js";
import plugin from "../server.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
describe("github plugin", () => {
  it("derives a stable id and registers a nav panel", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(derivePluginId(pkg.name)).toBe("github");
    const set = collectTestPluginApp(app, "github");
    expect(set.navPanels[0]?.title).toBe("GitHub");
  });

  it("registers issue and PR mention providers", async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: "github" });
    // Force the fallback path deterministically: never spawn the real `gh` CLI
    // (a real subprocess flakes under full-suite parallel load, timing out).
    await plugin(zcc, {
      ghJson: async () => {
        throw new Error("gh offline");
      }
    });
    expect(harness.mentionProviders.map((row) => row.id)).toEqual(["issue", "pr"]);
    harness.setSettings({ repo: "acme/app" });
    await expect(harness.mentionProviders[0]!.search({ query: "12" })).resolves.toEqual([
      { id: "acme/app#12", label: "Issue acme/app#12", insertText: "@acme/app#12" }
    ]);
    await expect(harness.mentionProviders[0]!.resolve("acme/app#12")).resolves.toMatchObject({
      context: expect.stringContaining("acme/app#12")
    });
  });
});
