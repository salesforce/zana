// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const state = vi.hoisted(() => ({ rpc: { call: vi.fn() } }));
vi.mock("@zana-ai/zcc-plugin-sdk/app", () => ({
  definePluginApp: () => undefined,
  useRpc: () => state.rpc,
}));
import { UsagePanel } from "./app.tsx";
afterEach(() => {
  cleanup();
  state.rpc.call.mockReset();
});
it("renders quota windows, stale readings and provider authentication errors", async () => {
  const rows = [
    {
      hostId: "local",
      hostName: "Local",
      providerId: "test",
      providerName: "Test",
      updatedAt: 100,
      result: {
        supported: true,
        usage: {
          status: "ok",
          planLabel: "Pro",
          accountEmail: "test@example.test",
          windows: [
            { label: "Session", usedPercent: 25, resetsAt: 200 },
            { label: "Weekly", usedPercent: 50, resetsAt: null },
          ],
        },
      },
    },
    {
      hostId: "remote",
      hostName: "Remote",
      providerId: "test",
      providerName: "Test",
      updatedAt: 0,
      error: "Last refresh failed",
      result: {
        supported: true,
        usage: { status: "error", message: "Please sign in" },
      },
    },
  ];
  state.rpc.call.mockResolvedValue(rows);
  render(<UsagePanel />);
  await screen.findByText("75% remaining");
  expect(screen.getByText("Please sign in")).toBeTruthy();
  expect(screen.getByText("Reset time unavailable")).toBeTruthy();
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  state.rpc.call.mockRejectedValueOnce(Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Could not refresh",
  );
  expect(screen.getByText("75% remaining")).toBeTruthy();
});
it("shows an empty state and reports a failed initial load", async () => {
  state.rpc.call.mockRejectedValue(Error("offline"));
  render(<UsagePanel />);
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Could not load usage.",
  );
  expect(screen.getByRole("status").textContent).toContain("No supported");
});
