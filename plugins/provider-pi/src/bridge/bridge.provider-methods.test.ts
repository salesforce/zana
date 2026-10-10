import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type FakePiBridgeHarness,
  startFakePiBridge,
} from "./test-support.js";

const maintenance = vi.hoisted(() => ({
  status: vi.fn(),
  run: vi.fn(),
}));

vi.mock("./provider-maintenance.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./provider-maintenance.js")>()),
  getPiProviderInstallationStatus: maintenance.status,
  getPiProviderInstallationRun: maintenance.run,
}));

let harness: FakePiBridgeHarness;

beforeEach(async () => {
  maintenance.status.mockReset();
  maintenance.run.mockReset();
  harness = await startFakePiBridge({
    prefix: "bb-pi-provider-methods-",
    initialize: true,
  });
});

afterEach(async () => {
  await harness.teardown();
});

it("answers provider/usage as unsupported", async () => {
  const response = await harness.request(1, "provider/usage", {
    providerId: "pi",
  });
  expect(response.result).toEqual({ supported: false });
});

it("returns the installation status from the maintenance probe", async () => {
  const status = { executableName: "pi", installed: true, needsUpdate: false };
  maintenance.status.mockResolvedValue(status);
  const response = await harness.request(2, "provider/installation/status", {
    providerId: "pi",
  });
  expect(maintenance.status).toHaveBeenCalledTimes(1);
  expect(response.result).toEqual(status);
});

it("forwards the requested action to the installation run", async () => {
  const run = { available: false, message: "Pi update is no longer available on this host." };
  maintenance.run.mockResolvedValue(run);
  const response = await harness.request(3, "provider/installation/run", {
    providerId: "pi",
    action: "update",
  });
  expect(maintenance.run).toHaveBeenCalledWith("update");
  expect(response.result).toEqual(run);
});
