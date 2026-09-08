import { expect, it } from "vitest";
import { runFirstPartyRecordedConformance } from "@zana-ai/zcc-provider-bridge-protocol/testing";

it("reproduces every recorded matrix cell", async () => {
  const run = await runFirstPartyRecordedConformance({
    servesProvider: (providerId) => providerId === "codex",
    label: "codex",
  });
  expect(run.cells.length).toBeGreaterThan(0);
  console.info(run.report);
  expect(run.failures).toEqual([]);
}, 240_000);
