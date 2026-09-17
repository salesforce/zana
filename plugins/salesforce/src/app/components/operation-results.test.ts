import { describe, expect, it } from "vitest";
import type { SalesforceOperation } from "../../../lib/workbench-contract.js";
import {
  operationResultView,
  resultEntryEvidence,
} from "./operation-results.js";

export const operation: SalesforceOperation = {
  id: "op-1",
  projectId: "project-1",
  kind: "apex.test",
  title: "OrderTest",
  org: {
    alias: "original-org",
    kind: "sandbox",
    orgId: "00D000000000001",
    username: "dev@example.com",
    instanceUrl: "https://example.com",
    apiVersion: "62.0",
  },
  at: 1,
  state: "failed",
};
const view = (kind: SalesforceOperation["kind"], data: unknown) =>
  operationResultView({ ...operation, kind, data });

describe("operation report projection", () => {
  it("shows Tooling test failures, namespaced methods, stack traces and explicit totals", () => {
    const result = view("apex.test", {
      numTestsRun: 3,
      numFailures: 2,
      totalTime: 37,
      failures: [
        {
          namespace: "sales",
          name: "OrderTest",
          methodName: "saves",
          message: "Expected 2, got 1",
          stackTrace: "Class.OrderTest.saves: line 8",
          line: 8,
          column: 2,
        },
      ],
      successes: [{ name: "OrderTest", methodName: "loads" }],
      codeCoverageWarnings: [{ name: "Order", message: "Coverage is 50%" }],
    });
    expect(result.metrics).toEqual([
      { label: "Tests run", value: "3" },
      { label: "Test failures", value: "2" },
      { label: "Test duration", value: "37 ms" },
    ]);
    expect(result.sections.map((section) => section.title)).toEqual([
      "Test failures",
      "Coverage warnings",
      "Passed tests",
    ]);
    expect(result.sections[0].entries[0]).toMatchObject({
      title: "sales.OrderTest.saves",
      tone: "error",
      message: "Expected 2, got 1",
      location: "line 8, column 2",
      stack: "Class.OrderTest.saves: line 8",
    });
    expect(result.sections[2].entries[0]).toMatchObject({
      title: "OrderTest.loads",
      tone: "success",
      status: "Passed",
    });
  });

  it.each([
    null,
    undefined,
    [],
    "unexpected",
    {
      successes: "not an array",
      numFailures: "NaN",
      numTestsRun: -1,
      totalTime: Infinity,
    },
  ])(
    "does not turn missing or malformed evidence into a passing test: %j",
    (data) => {
      const result = view("apex.test", data);
      expect(result.metrics).toEqual([]);
      expect(result.sections).toEqual([]);
      expect(result.emptyPreview).toBe(false);
    },
  );

  it("accepts singleton SOAP test results and finite string counts without inventing totals", () => {
    const result = view("apex.test", {
      numFailures: "0",
      totalTime: "0.5",
      successes: { className: "OtherTest", methodName: "works" },
      codeCoverageWarnings: [{}],
      failures: [null, 1, [], { message: "Unknown test failed" }],
    });
    expect(result.metrics).toEqual([
      { label: "Test failures", value: "0" },
      { label: "Test duration", value: "0.5 ms" },
    ]);
    expect(result.sections[0].entries).toHaveLength(1);
    expect(result.sections[0].entries[0].title).toBe("Apex test");
    expect(result.sections[1].entries[0].title).toBe("Code coverage");
    expect(result.sections[2].entries[0].title).toBe("OtherTest.works");
  });

  it("separates anonymous Apex compilation failures and runtime exceptions", () => {
    const compile = view("apex.anonymous", {
      compiled: false,
      success: false,
      compileProblem: "Unexpected token",
      line: 4,
    });
    expect(compile.metrics).toEqual([
      { label: "Compiled", value: "No" },
      { label: "Execution", value: "Failed" },
    ]);
    expect(compile.sections[0].entries[0]).toMatchObject({
      message: "Unexpected token",
      location: "line 4",
    });
    const runtime = view("apex.anonymous", {
      compiled: true,
      success: false,
      exceptionMessage: "Null pointer",
      exceptionStackTrace: "AnonymousBlock: line 3",
    });
    expect(runtime.sections[0].title).toBe("Runtime exception");
    expect(runtime.sections[0].entries[0].stack).toContain("line 3");
    expect(
      view("apex.anonymous", { compiled: true, success: true }).metrics[1]
        .value,
    ).toBe("Passed");
    expect(view("apex.anonymous", {}).metrics).toEqual([]);
    expect(
      view("apex.anonymous", {
        compileProblem: "problem",
        exceptionStackTrace: "stack",
      }).sections,
    ).toHaveLength(2);
  });

  it.each(["deploy.preview", "retrieve.preview"] as const)(
    "groups actual CLI %s output and puts conflicts before changes",
    (kind) => {
      const result = view(kind, {
        conflicts: [
          {
            type: "ApexClass",
            fullName: "Order",
            projectRelativePath: "force-app/Order.cls",
            path: "/project/force-app/Order.cls",
          },
        ],
        toDelete: [{ type: "ApexClass", fullName: "Old" }],
        toDeploy: [{ type: "ApexClass", fullName: "New" }],
        toRetrieve: [{ type: "CustomObject", fullName: "Invoice__c" }],
        ignored: [{ type: "ApexClass", fullName: "Ignore" }],
      });
      expect(result.preview).toBe(true);
      expect(result.sections.map((section) => section.title)).toEqual([
        "Conflicts",
        "To delete",
        "To deploy",
        "To retrieve",
        "Ignored",
      ]);
      expect(result.sections[0].entries[0]).toMatchObject({
        title: "ApexClass:Order",
        location: "force-app/Order.cls",
        status: "Conflict",
        tone: "error",
      });
      expect(result.emptyPreview).toBe(false);
    },
  );

  it("calls a preview empty only when all known groups are explicitly empty", () => {
    const empty = {
      conflicts: [],
      toDelete: [],
      toDeploy: [],
      toRetrieve: [],
      ignored: [],
    };
    expect(view("deploy.preview", empty).emptyPreview).toBe(true);
    expect(view("deploy.preview", { toDeploy: [] }).emptyPreview).toBe(false);
    expect(
      view("deploy.preview", { ...empty, conflicts: "unsupported" })
        .emptyPreview,
    ).toBe(false);
    expect(view("deploy.start", empty).emptyPreview).toBe(false);
  });

  it("reads deployment reports with component errors, test failures and file states", () => {
    const result = view("deploy.validate", {
      status: "Failed",
      numberComponentsDeployed: 1,
      numberComponentsTotal: 2,
      numberComponentErrors: 1,
      numberTestsCompleted: 0,
      numberTestsTotal: 1,
      numberTestErrors: 1,
      details: {
        componentFailures: {
          componentType: "ApexClass",
          fullName: "Order",
          fileName: "classes/Order.cls",
          lineNumber: "10",
          columnNumber: "4",
          problem: "Unknown field",
        },
        runTestResult: {
          numFailures: 1,
          failures: [
            {
              name: "OrderTest",
              methodName: "fails",
              message: "Assertion failed",
            },
          ],
        },
        componentSuccesses: [{ fullName: "Should not duplicate files" }],
      },
      files: [
        {
          type: "ApexClass",
          fullName: "Order",
          filePath: "force-app/Order.cls",
          state: "Failed",
          error: "Compilation error",
        },
        { fullName: "Other", state: "Changed" },
      ],
    });
    expect(result.metrics.map((metric) => metric.value)).toEqual([
      "Failed",
      "1",
      "2",
      "1",
      "0",
      "1",
      "1",
      "1",
    ]);
    expect(result.sections.map((section) => section.title)).toEqual([
      "Component failures",
      "Test failures",
      "Files",
    ]);
    expect(result.sections[0].entries[0]).toMatchObject({
      location: "classes/Order.cls · line 10, column 4",
      message: "Unknown field",
    });
    expect(result.sections[2].entries[0]).toMatchObject({
      status: "Failed",
      tone: "error",
      message: "Compilation error",
      location: "force-app/Order.cls",
    });
    expect(result.sections[2].entries[1]).toMatchObject({
      status: "Changed",
      tone: undefined,
    });
  });

  it("preserves partial component and retrieve results without calling them successes", () => {
    expect(
      view("deploy.start", {
        details: { componentSuccesses: { fullName: "Order" } },
      }).sections[0].entries[0],
    ).toMatchObject({ title: "Order", status: "Reported", tone: undefined });
    const result = view("retrieve.start", {
      files: [
        { path: "classes/Order.cls", success: false, message: "Denied" },
        {},
      ],
    });
    expect(result.sections[0].entries[0]).toMatchObject({
      title: "classes/Order.cls",
      tone: "error",
      message: "Denied",
    });
    expect(result.sections[0].entries[1].title).toBe("Metadata component");
  });

  it("shows retained Jest output and exit code without interpreting stderr as failure", () => {
    const result = view("lwc.test", {
      code: 0,
      stderr: "PASS component.test.js",
      stdout: "Output",
    });
    expect(result.metrics).toEqual([{ label: "Exit code", value: "0" }]);
    expect(
      result.sections
        .flatMap((section) => section.entries)
        .map((entry) => entry.title),
    ).toEqual(["Standard output", "Standard error"]);
    expect(result.sections[1].entries[0].tone).toBeUndefined();
    expect(view("lwc.test", { code: "0" }).metrics).toEqual([]);
  });

  it("bounds details across sections and retains failures before successful tests", () => {
    const result = view("apex.test", {
      failures: Array.from({ length: 201 }, (_, index) => ({
        name: `Failure${index}`,
      })),
      successes: [{ name: "Success" }],
    });
    expect(result.sections[0].entries).toHaveLength(200);
    expect(result.sections).toHaveLength(1);
    expect(result.truncated).toBe(true);
    const preview = view("deploy.preview", {
      conflicts: [{}],
      toDeploy: Array(200).fill({ fullName: "Change" }),
      ignored: [{}],
    });
    expect(preview.sections[0].title).toBe("Conflicts");
    expect(preview.sections[1].entries).toHaveLength(199);
  });

  it("stages only the selected evidence with its original target and bounded size", () => {
    const entry = {
      title: "OrderTest.fails",
      status: "Failed",
      message: "Assertion failed",
      stack: "Class.OrderTest: line 2",
      location: "line 2",
    };
    expect(
      resultEntryEvidence({ ...operation, jobId: "0Af000000000001" }, entry),
    ).toBe(
      "apex.test · original-org\nOperation op-1 · Job 0Af000000000001\nFailed: OrderTest.fails\nline 2\nAssertion failed\nClass.OrderTest: line 2",
    );
    expect(
      resultEntryEvidence(operation, { ...entry, message: "x".repeat(9000) }),
    ).toHaveLength(8000);
    expect(
      resultEntryEvidence(operation, { title: "Only", status: "Reported" }),
    ).not.toContain("undefined");
    expect(
      view("apex.test", { failures: [{ message: "x".repeat(5000) }] })
        .sections[0].entries[0].message,
    ).toHaveLength(4000);
  });
});
