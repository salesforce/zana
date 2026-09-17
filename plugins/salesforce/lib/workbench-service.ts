import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  compactError,
  parsePackageDirectories,
  resolveUnderRoot,
} from "./dx-project.js";
import {
  inputRecord,
  inputText,
  type ProjectContexts,
} from "./project-context.js";
import type { ExplorerKv } from "./soql-history.js";
import type { SalesforceSdk } from "./sdk-contract.js";
import type { SalesforceDeps, ToolResult } from "./types.js";
import type {
  OperationKind,
  SalesforceOperation,
} from "./workbench-contract.js";

const OPERATION_KEY = "workbench:operations";
const KINDS: OperationKind[] = [
  "apex.test",
  "apex.anonymous",
  "lwc.test",
  "deploy.preview",
  "deploy.validate",
  "deploy.start",
  "retrieve.preview",
  "retrieve.start",
];
const NAME = /^[A-Za-z][\w]*$/;
const METADATA = /^[A-Za-z][\w]*:[A-Za-z][\w.]*$/;

/** Public evidence is bounded before storage or transport, with credentials omitted recursively. */
export function publicEvidence(value: unknown): unknown {
  let budget = 60_000;
  const visit = (item: unknown, depth: number): unknown => {
    if (budget <= 0 || depth > 10) return "[truncated]";
    if (typeof item === "string") {
      const text = item.slice(0, Math.min(budget, 16_000));
      budget -= text.length;
      return text;
    }
    if (Array.isArray(item))
      return item.slice(0, 200).map((row) => visit(row, depth + 1));
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item)
          .slice(0, 100)
          .filter(([key]) => !/token|authorization|password|secret/i.test(key))
          .map(([key, row]) => {
            budget -= key.length;
            return [key, visit(row, depth + 1)];
          }),
      );
    }
    budget -= 8;
    return item;
  };
  return visit(value, 0);
}

export function metadataSelection(input: unknown): string[] {
  const values = inputRecord(input).components;
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.length > 50 ||
    values.some((item) => typeof item !== "string" || !METADATA.test(item))
  ) {
    throw new Error(
      "Select 1–50 explicit metadata components (for example ApexClass:OrderService).",
    );
  }
  return [...new Set(values)] as string[];
}

export class WorkbenchService {
  private writes: Promise<unknown> = Promise.resolve();
  private active = new Set<string>();
  private disposed = false;

  constructor(
    private readonly deps: {
      sdk: SalesforceSdk;
      contexts: ProjectContexts;
      fs: SalesforceDeps;
      kv: ExplorerKv;
      apex(input: unknown, origin: { threadId: string }): Promise<ToolResult>;
      lwc(input: unknown): Promise<ToolResult>;
    },
  ) {}

  dispose(): void {
    this.disposed = true;
  }

  private async update(operation: SalesforceOperation): Promise<void> {
    const write = this.writes.then(async () => {
      const rows =
        (await this.deps.kv.get<SalesforceOperation[]>(OPERATION_KEY)) ?? [];
      await this.deps.kv.set(
        OPERATION_KEY,
        [operation, ...rows.filter((row) => row.id !== operation.id)].slice(
          0,
          100,
        ),
      );
    });
    this.writes = write.catch(() => {});
    return write;
  }

  async list(): Promise<{ ok: true; operations: SalesforceOperation[] }> {
    await this.writes;
    const projectId = this.deps.contexts.current()?.projectId ?? null;
    const rows =
      (await this.deps.kv.get<SalesforceOperation[]>(OPERATION_KEY)) ?? [];
    return {
      ok: true,
      operations: rows
        .filter((row) => row.projectId === projectId)
        .slice(0, 30)
        .map((row) => ({
          ...row,
          state:
            row.state === "running" && !this.active.has(row.id)
              ? "interrupted"
              : row.state,
        })),
    };
  }

  async record(input: unknown) {
    const objectName = inputText(input, "objectName");
    const recordId = inputText(input, "recordId");
    if (!NAME.test(objectName) || !/^[a-zA-Z0-9]{15,18}$/.test(recordId))
      throw new Error("Choose a valid object and Salesforce record id.");
    await this.readGate(input);
    const { org, response } = await this.deps.sdk.request(
      `/sobjects/${objectName}/${recordId}`,
    );
    if (response.status >= 400)
      throw new Error(
        compactError(response.status, response.json, response.text),
      );
    return {
      ok: true,
      org,
      record: publicEvidence(response.json),
      fetchedAt: this.deps.fs.now(),
    };
  }

  async log(input: unknown) {
    const id = inputText(input, "logId");
    if (!/^[a-zA-Z0-9]{15,18}$/.test(id))
      throw new Error("Choose a valid debug log.");
    await this.readGate(input);
    const { org, response } = await this.deps.sdk.request(
      `/tooling/sobjects/ApexLog/${id}/Body`,
    );
    if (response.status >= 400)
      throw new Error(
        compactError(response.status, response.json, response.text),
      );
    return {
      ok: true,
      org,
      body: response.text.slice(0, 64_000),
      truncated: response.text.length > 64_000,
    };
  }

  async metadata(input: unknown) {
    const type = inputText(input, "metadataType") || "ApexClass";
    if (
      ![
        "ApexClass",
        "ApexTrigger",
        "LightningComponentBundle",
        "CustomObject",
        "PermissionSet",
        "Flow",
      ].includes(type)
    )
      throw new Error("Choose a supported metadata type.");
    const org = await this.readGate(input);
    const result = await this.deps.sdk.execSf([
      "org",
      "list",
      "metadata",
      "--metadata-type",
      type,
      "--target-org",
      org.alias,
      "--json",
    ]);
    const parsed = this.parseCli(result);
    const records = Array.isArray(parsed) ? parsed : [];
    return {
      ok: true,
      org,
      records: publicEvidence(records),
      truncated: records.length > 200,
    };
  }

  private async readGate(input: unknown) {
    const org = await this.deps.sdk.connect();
    const decision = await this.deps.sdk.confirm(
      {
        orgAlias: org.alias,
        orgId: org.orgId,
        orgKind: org.kind,
        summary: `Read Salesforce evidence from ${org.alias}`,
      },
      inputText(input, "threadId"),
    );
    if (!decision.approved)
      throw new Error(
        "Org access needs approval in a thread. Open this tool beside an agent and retry.",
      );
    return org;
  }

  async start(input: unknown) {
    if (this.disposed || this.active.size >= 3)
      throw new Error(
        "Three Salesforce operations are already running. Wait for one to finish.",
      );
    const kind = inputText(input, "kind") as OperationKind;
    if (!KINDS.includes(kind))
      throw new Error("Choose a supported Salesforce operation.");
    const snapshot = await this.deps.contexts.settings();
    const isMetadata =
      kind.startsWith("deploy.") || kind.startsWith("retrieve.");
    let components: string[] = [];
    if (isMetadata) {
      if (!this.deps.contexts.isDx())
        throw new Error("This operation requires a Salesforce DX project.");
      // The CLI follows packageDirectories; confine each before allowing a local write/read.
      const config =
        this.deps.fs.readFile(
          join(snapshot.projectRoot, "sfdx-project.json"),
        ) ?? "";
      for (const dir of parsePackageDirectories(config)) {
        if (!resolveUnderRoot(snapshot.projectRoot, dir, this.deps.fs.realpath))
          throw new Error(
            "A package directory is outside this project or unavailable.",
          );
      }
      if (kind !== "retrieve.preview") components = metadataSelection(input);
    }
    if (kind === "deploy.validate" || kind === "deploy.start") {
      const tests = inputRecord(input).tests;
      if (
        !Array.isArray(tests) ||
        !tests.length ||
        tests.length > 30 ||
        tests.some((name) => typeof name !== "string" || !NAME.test(name))
      )
        throw new Error(
          "Specify the targeted Apex test classes to run for this deployment.",
        );
    }
    const org = await this.deps.sdk.connect();
    // Reserve before async storage/approval, so simultaneous callers cannot overfill the limit.
    if (this.active.size >= 3)
      throw new Error("Three Salesforce operations are already running.");
    const row: SalesforceOperation = {
      id: randomUUID(),
      kind,
      projectId: this.deps.contexts.current()?.projectId ?? null,
      org,
      title:
        inputText(input, "className") ||
        components.join(", ") ||
        kind.replace(".", " "),
      at: this.deps.fs.now(),
      state: "running",
    };
    this.active.add(row.id);
    try {
      await this.update(row);
    } catch (error) {
      this.active.delete(row.id);
      throw error;
    }
    // The current AsyncLocalStorage snapshot is inherited by this detached promise.
    void this.execute(row, input, components)
      .then(async (result) => {
        row.summary = result.summary;
        row.data = publicEvidence(result.data);
        row.jobId = result.jobId;
        row.state = result.failed
          ? "failed"
          : result.jobId
            ? "submitted"
            : "succeeded";
      })
      .catch((error) => {
        row.state = "failed";
        row.summary = error instanceof Error ? error.message : String(error);
      })
      .finally(async () => {
        try {
          if (!this.disposed) await this.update(row);
        } finally {
          this.active.delete(row.id);
        }
      })
      .catch(() => {});
    return { ok: true, operation: row };
  }

  private async execute(
    row: SalesforceOperation,
    input: unknown,
    components: string[],
  ) {
    const threadId = inputText(input, "threadId");
    const raw = inputRecord(input);
    if (row.kind.startsWith("apex.") || row.kind === "lwc.test") {
      const result =
        row.kind === "lwc.test"
          ? await this.deps.lwc({
              action: "test.jest",
              component: inputText(input, "component"),
            })
          : await this.deps.apex(
              {
                ...raw,
                action: row.kind === "apex.test" ? "test.run" : "anon.run",
              },
              { threadId },
            );
      if (!result.ok) throw new Error(result.error);
      const data = inputRecord(result.data);
      const failed =
        data.success === false ||
        data.compiled === false ||
        Number(data.numFailures) > 0;
      return {
        summary: result.summary,
        data: result.data,
        jobId: undefined,
        failed,
      };
    }
    const mutates =
      row.kind === "deploy.start" || row.kind === "retrieve.start";
    const decision = await this.deps.sdk.confirm(
      {
        orgAlias: row.org.alias,
        orgId: row.org.orgId,
        orgKind: row.org.kind,
        kind: mutates ? "org.write" : undefined,
        summary: `${row.kind} on ${row.org.alias}: ${components.join(", ") || "tracked changes"}`,
        preview:
          row.kind === "retrieve.start"
            ? "Selected org metadata will overwrite matching local files. Commit or back up local changes before approving."
            : components.join("\n"),
      },
      threadId,
    );
    if (!decision.approved)
      throw new Error(
        "This action needs approval in a thread. Open the deployment tool beside an agent and retry.",
      );
    const args = ["project", ...row.kind.split(".")];
    // A dry run works in both sandboxes and production and executes only selected tests.
    if (row.kind === "deploy.validate") args.splice(2, 1, "start", "--dry-run");
    args.push("--target-org", row.org.alias, "--json");
    for (const component of components) args.push("--metadata", component);
    if (row.kind === "deploy.start" || row.kind === "deploy.validate") {
      args.push("--async", "--test-level", "RunSpecifiedTests");
      for (const name of raw.tests as string[]) args.push("--tests", name);
    }
    const settings = await this.deps.contexts.settings();
    const data = this.parseCli(
      await this.deps.sdk.execSf(args, {
        cwd: settings.projectRoot,
        timeoutMs: 120_000,
      }),
    );
    const result = inputRecord(data);
    const jobId =
      (row.kind === "deploy.start" || row.kind === "deploy.validate") &&
      typeof result.id === "string"
        ? result.id
        : undefined;
    return {
      summary: jobId
        ? "Submitted to Salesforce. Refresh the report to check progress."
        : "Completed",
      data,
      jobId,
      failed: result.success === false,
    };
  }

  async report(input: unknown) {
    const { operations } = await this.list();
    const row = operations.find(
      (operation) => operation.id === inputText(input, "operationId"),
    );
    if (!row?.jobId || !/^[a-zA-Z0-9]{15,18}$/.test(row.jobId))
      throw new Error("No Salesforce job is available for this operation.");
    const decision = await this.deps.sdk.confirm(
      {
        orgAlias: row.org.alias,
        orgId: row.org.orgId,
        orgKind: row.org.kind,
        summary: `Read deployment report from ${row.org.alias}`,
      },
      inputText(input, "threadId"),
    );
    if (!decision.approved)
      throw new Error("Org access needs approval in a thread.");
    const data = this.parseCli(
      await this.deps.sdk.execSf([
        "project",
        "deploy",
        "report",
        "--job-id",
        row.jobId,
        "--target-org",
        row.org.alias,
        "--json",
      ]),
      true,
    );
    const result = inputRecord(data);
    row.state =
      result.done === true
        ? result.success === true
          ? "succeeded"
          : "failed"
        : "submitted";
    row.summary = typeof result.status === "string" ? result.status : row.state;
    row.data = publicEvidence(data);
    await this.update(row);
    return { ok: true, operation: row };
  }

  private parseCli(
    result: { code: number; stdout: string; stderr: string },
    report = false,
  ): unknown {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new Error(
        result.stderr.slice(0, 400) ||
          "Salesforce CLI did not return valid JSON.",
      );
    }
    if (
      report &&
      inputRecord(parsed.result).done === true &&
      typeof inputRecord(parsed.result).success === "boolean"
    )
      return parsed.result;
    if (
      result.code !== 0 ||
      (typeof parsed.status === "number" && parsed.status !== 0)
    )
      throw new Error(compactError(result.code, parsed, result.stderr));
    return parsed.result;
  }
}
