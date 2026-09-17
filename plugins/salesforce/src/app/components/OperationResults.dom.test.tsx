/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { SalesforceOperation } from "../../../lib/workbench-contract.js";
import { RunSummary, SalesforcePanelFrame } from "../../../ui.js";

const operation: SalesforceOperation = {
  id: "op",
  projectId: "p",
  kind: "apex.test",
  title: "Targeted tests",
  at: 1,
  state: "failed",
  org: {
    alias: "dev",
    kind: "sandbox",
    orgId: "00D000000000001",
    username: "dev@example.com",
    instanceUrl: "https://example.com",
    apiVersion: "62.0",
  },
};
afterEach(cleanup);

describe("readable operation results", () => {
  it("shows failures first and stages one failure without other report data", () => {
    const stage = vi.fn();
    const refresh = vi.fn();
    render(
      <SalesforcePanelFrame>
        <RunSummary
          operation={{
            ...operation,
            jobId: "0Af000000000001",
            data: {
              numTestsRun: 2,
              numFailures: 1,
              failures: [
                {
                  name: "OrderTest",
                  methodName: "fails",
                  message: "Expected 2, got 1",
                  stackTrace: "Class.OrderTest.fails: line 8",
                },
              ],
              successes: [{ name: "UnrelatedTest", methodName: "works" }],
            },
          }}
          onAddToPrompt={stage}
          onRefresh={refresh}
        />
      </SalesforcePanelFrame>,
    );
    const failures = screen.getByRole("region", { name: "Test failures" });
    expect(within(failures).getByText("Expected 2, got 1")).toBeTruthy();
    expect(
      within(failures).getByText("Stack trace").closest("details")?.open,
    ).toBe(false);
    expect(
      screen.getByText("Retained report JSON").closest("details")?.open,
    ).toBe(false);
    fireEvent.click(
      within(failures).getByRole("button", {
        name: "Add OrderTest.fails to prompt",
      }),
    );
    expect(stage).toHaveBeenCalledTimes(1);
    expect(stage.mock.calls[0][0]).toContain("apex.test · dev");
    expect(stage.mock.calls[0][0]).toContain("line 8");
    expect(stage.mock.calls[0][0]).not.toContain("UnrelatedTest");
    fireEvent.click(screen.getByRole("button", { name: "Refresh report" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Add result to prompt" }),
    );
    expect(stage.mock.calls[1][0]).toContain("UnrelatedTest");
  });

  it("offers conflict evidence in a preview and explains that no changes were applied", () => {
    const stage = vi.fn();
    render(
      <RunSummary
        operation={{
          ...operation,
          kind: "deploy.preview",
          state: "succeeded",
          data: {
            conflicts: [
              {
                type: "ApexClass",
                fullName: "Order",
                projectRelativePath: "force-app/Order.cls",
              },
            ],
            toDeploy: [{ type: "ApexClass", fullName: "New" }],
          },
        }}
        onAddToPrompt={stage}
      />,
    );
    expect(
      screen.getByText("Preview only. Listed changes have not been applied."),
    ).toBeTruthy();
    const conflict = screen.getByRole("region", { name: "Conflicts" });
    fireEvent.click(within(conflict).getByRole("button"));
    expect(stage.mock.calls[0][0]).toContain(
      "Conflict: ApexClass:Order\nforce-app/Order.cls",
    );
    expect(stage.mock.calls[0][0]).not.toContain("ApexClass:New");
  });

  it("has read-only, empty, running and unfamiliar-report states", () => {
    const mounted = render(
      <RunSummary operation={{ ...operation, state: "running" }} />,
    );
    expect(screen.queryByTestId("salesforce-operation-results")).toBeNull();
    mounted.rerender(
      <RunSummary
        operation={{ ...operation, data: { futureShape: "unknown" } }}
      />,
    );
    expect(screen.getByText(/No structured details/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    mounted.rerender(
      <RunSummary
        operation={{
          ...operation,
          kind: "retrieve.preview",
          data: {
            conflicts: [],
            toDeploy: [],
            toDelete: [],
            toRetrieve: [],
            ignored: [],
          },
        }}
      />,
    );
    expect(screen.getByText("No changes listed in this preview.")).toBeTruthy();
    mounted.rerender(
      <RunSummary
        operation={{
          ...operation,
          data: {
            failures: Array(201).fill({
              name: "Repeated",
              message: "<script>not executable</script>",
            }),
          },
        }}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(200);
    expect(screen.getByText(/Showing up to 200 details/)).toBeTruthy();
    expect(mounted.container.querySelector("script")).toBeNull();
  });
});
