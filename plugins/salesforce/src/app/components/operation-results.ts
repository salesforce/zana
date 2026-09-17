import type { SalesforceOperation } from "../../../lib/workbench-contract.js";

export interface ResultEntry {
  title: string;
  status: string;
  tone?: "error" | "success";
  location?: string;
  message?: string;
  stack?: string;
}
interface ResultSection {
  title: string;
  entries: ResultEntry[];
}
export interface OperationResultView {
  metrics: { label: string; value: string }[];
  sections: ResultSection[];
  preview: boolean;
  emptyPreview: boolean;
  truncated: boolean;
}

const MAX_ROWS = 200;
const text = (value: unknown): string =>
  typeof value === "string" ? value.slice(0, 4000) : "";
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const rows = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value]
      : [];
const count = (value: unknown): number | undefined => {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(\.\d+)?$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};
const location = (row: Record<string, unknown>): string => {
  const path =
    text(row.projectRelativePath) ||
    text(row.filePath) ||
    text(row.fileName) ||
    text(row.path);
  const line = count(row.lineNumber ?? row.line);
  const column = count(row.columnNumber ?? row.column);
  return [
    path,
    line !== undefined
      ? `line ${line}${column !== undefined ? `, column ${column}` : ""}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
};
const component = (
  value: unknown,
  status: string,
  tone?: ResultEntry["tone"],
): ResultEntry => {
  const row = record(value);
  const type = text(row.componentType) || text(row.type);
  return {
    title:
      [type, text(row.fullName)].filter(Boolean).join(":") ||
      location(row) ||
      "Metadata component",
    status,
    tone,
    location: location(row),
    message: text(row.problem) || text(row.error) || text(row.message),
  };
};
const test = (value: unknown, failed: boolean): ResultEntry => {
  const row = record(value);
  return {
    title: [
      text(row.namespace),
      text(row.name) || text(row.className) || "Apex test",
      text(row.methodName),
    ]
      .filter(Boolean)
      .join("."),
    status: failed ? "Failed" : "Passed",
    tone: failed ? "error" : "success",
    location: location(row),
    message: text(row.message),
    stack: text(row.stackTrace),
  };
};

/** Project only known report fields. Missing or unfamiliar evidence is never a passing test. */
export function operationResultView(
  operation: SalesforceOperation,
): OperationResultView {
  const data = record(operation.data);
  const view: OperationResultView = {
    metrics: [],
    sections: [],
    preview: operation.kind.endsWith(".preview"),
    emptyPreview: false,
    truncated: false,
  };
  let remaining = MAX_ROWS;
  const section = (
    title: string,
    source: unknown,
    map: (value: unknown) => ResultEntry,
  ) => {
    const values = rows(source);
    const visible = values.slice(0, remaining);
    view.truncated ||= values.length > remaining;
    remaining -= visible.length;
    const entries = visible
      .filter(
        (value) => value && typeof value === "object" && !Array.isArray(value),
      )
      .map(map);
    if (entries.length) view.sections.push({ title, entries });
  };
  const metric = (label: string, value: unknown, suffix = "") => {
    const number = count(value);
    if (number !== undefined)
      view.metrics.push({ label, value: `${number}${suffix}` });
  };
  const testResults = (result: Record<string, unknown>) => {
    metric("Tests run", result.numTestsRun);
    metric("Test failures", result.numFailures);
    metric("Test duration", result.totalTime, " ms");
    section("Test failures", result.failures, (value) => test(value, true));
    section("Coverage warnings", result.codeCoverageWarnings, (value) => ({
      title: text(record(value).name) || "Code coverage",
      status: "Warning",
      message: text(record(value).message),
    }));
    section("Passed tests", result.successes, (value) => test(value, false));
  };

  if (operation.kind === "apex.test") {
    testResults(data);
  } else if (operation.kind === "apex.anonymous") {
    if (typeof data.compiled === "boolean")
      view.metrics.push({
        label: "Compiled",
        value: data.compiled ? "Yes" : "No",
      });
    if (typeof data.success === "boolean")
      view.metrics.push({
        label: "Execution",
        value: data.success ? "Passed" : "Failed",
      });
    if (data.compiled === false || text(data.compileProblem))
      section(
        "Compilation",
        [
          {
            title: "Anonymous Apex",
            status: "Failed",
            tone: "error",
            location: location(data),
            message: text(data.compileProblem),
          },
        ],
        (value) => value as ResultEntry,
      );
    if (text(data.exceptionMessage) || text(data.exceptionStackTrace))
      section(
        "Runtime exception",
        [
          {
            title: "Anonymous Apex",
            status: "Failed",
            tone: "error",
            message: text(data.exceptionMessage),
            stack: text(data.exceptionStackTrace),
          },
        ],
        (value) => value as ResultEntry,
      );
  } else if (
    operation.kind.startsWith("deploy.") ||
    operation.kind.startsWith("retrieve.")
  ) {
    if (text(data.status))
      view.metrics.push({
        label: "Salesforce status",
        value: text(data.status),
      });
    metric("Components deployed", data.numberComponentsDeployed);
    metric("Components total", data.numberComponentsTotal);
    metric("Component errors", data.numberComponentErrors);
    metric("Tests completed", data.numberTestsCompleted);
    metric("Tests total", data.numberTestsTotal);
    metric("Test errors", data.numberTestErrors);
    const details = record(data.details);
    section("Component failures", details.componentFailures, (value) =>
      component(value, "Failed", "error"),
    );
    // Failures and conflicts get the bounded view's budget before successful changes.
    section("Conflicts", data.conflicts, (value) =>
      component(value, "Conflict", "error"),
    );
    testResults(record(details.runTestResult));
    const groups = [
      ["To delete", "toDelete", "Delete"],
      ["To deploy", "toDeploy", "Deploy"],
      ["To retrieve", "toRetrieve", "Retrieve"],
      ["Ignored", "ignored", "Ignored"],
    ] as const;
    for (const [title, key, status] of groups)
      section(title, data[key], (value) => component(value, status));
    const previewKeys = ["conflicts", ...groups.map(([, key]) => key)];
    view.emptyPreview =
      view.preview &&
      previewKeys.every(
        (key) => Array.isArray(data[key]) && data[key].length === 0,
      );
    section("Files", data.files, (value) => {
      const row = record(value);
      const state = text(row.state) || "Reported";
      return component(
        value,
        state,
        state === "Failed" || row.success === false ? "error" : undefined,
      );
    });
    if (!Array.isArray(data.files))
      section("Components", details.componentSuccesses, (value) =>
        component(value, "Reported"),
      );
  } else if (operation.kind === "lwc.test") {
    if (typeof data.code === "number" && Number.isInteger(data.code))
      view.metrics.push({ label: "Exit code", value: String(data.code) });
    for (const key of ["stdout", "stderr"] as const) {
      if (text(data[key]))
        section(
          "Test output",
          [
            {
              title: key === "stdout" ? "Standard output" : "Standard error",
              status: "Output",
              message: text(data[key]),
            },
          ],
          (value) => value as ResultEntry,
        );
    }
  }
  return view;
}

export function resultEntryEvidence(
  operation: SalesforceOperation,
  entry: ResultEntry,
): string {
  return [
    `${operation.kind} · ${operation.org.alias}`,
    `Operation ${operation.id}${operation.jobId ? ` · Job ${operation.jobId}` : ""}`,
    `${entry.status}: ${entry.title}`,
    entry.location,
    entry.message,
    entry.stack,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 8000);
}
