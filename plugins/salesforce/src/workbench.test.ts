import { describe, expect, it, vi } from "vitest";
import {
  ProjectContexts,
  inputRecord,
  inputText,
} from "../lib/project-context.js";
import {
  WorkbenchService,
  metadataSelection,
  publicEvidence,
} from "../lib/workbench-service.js";
import type { SalesforceSdk } from "../lib/sdk-contract.js";
import type { SalesforceDeps, PluginSettingsValues } from "../lib/types.js";
import type { SalesforceOperation } from "../lib/workbench-contract.js";

function fixture() {
  const stored = new Map<string, unknown>();
  const kv = {
    get: async <T>(key: string) => stored.get(key) as T | undefined,
    set: async (key: string, value: unknown) => {
      stored.set(key, structuredClone(value));
    },
  };
  const settings = {
    defaultOrg: "shared",
    apiVersion: "62.0",
    projectRoot: "/legacy",
  } as PluginSettingsValues;
  const fs = {
    now: () => Date.now(),
    realpath: (path: string) => {
      if (path.includes("missing")) throw Error("missing");
      return path.includes("escape") ? "/outside" : path;
    },
    exists: (path: string) => path.endsWith("sfdx-project.json"),
    readFile: () => '{"packageDirectories":[{"path":"force-app"}]}',
  } as SalesforceDeps;
  const projects = vi.fn(async () => [
    { id: "a", name: "Alpha", path: "/alpha" },
    { id: "b", name: "Beta", path: "/beta" },
    { id: "remote", name: "Remote" },
    { id: "missing", name: "Missing", path: "/missing" },
  ]);
  const fallback = vi.fn(async () => "cli-default");
  const contexts = new ProjectContexts({
    settings: async () => settings,
    projects,
    resolveAlias: fallback,
    kv,
    fs,
  });
  const org = (alias: string) => ({
    alias,
    username: `${alias}@example.com`,
    orgId: "00D000000000001",
    instanceUrl: "https://test.invalid",
    kind: "sandbox" as const,
    apiVersion: "62.0",
  });
  const sdk = {
    connect: vi.fn(async () => org((await contexts.settings()).defaultOrg)),
    confirm: vi.fn(async () => ({ approved: true, reason: "submitted" })),
    request: vi.fn(async () => ({
      org: org("shared"),
      response: {
        status: 200,
        json: { Id: "001000000000001", Name: "Acme", accessToken: "private" },
        text: "log\n".repeat(20_000),
      },
    })),
    execSf: vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({ status: 0, result: { success: true } }),
      stderr: "",
    })),
  };
  const apex = vi.fn(async () => ({
    ok: true as const,
    summary: "Tests completed",
    data: { numFailures: 0 },
  }));
  const lwc = vi.fn(async () => ({
    ok: true as const,
    summary: "Jest passed",
    data: { success: true },
  }));
  const service = new WorkbenchService({
    sdk: sdk as unknown as SalesforceSdk,
    contexts,
    fs,
    kv,
    apex,
    lwc,
  });
  const run = <T>(
    work: () => Promise<T>,
    input: unknown = { projectId: "a" },
  ) => contexts.run(input, work);
  const settle = async () => {
    await vi.waitFor(async () => {
      expect(
        (await run(() => service.list())).operations.some(
          (row) => row.state === "running",
        ),
      ).toBe(false);
    });
  };
  return {
    contexts,
    settings,
    kv,
    stored,
    fs,
    sdk,
    apex,
    lwc,
    service,
    run,
    settle,
    fallback,
  };
}

describe("project target snapshots", () => {
  it("isolates simultaneous projects, overrides, and the shared fallback", async () => {
    const f = fixture();
    await f.contexts.select({ projectId: "a", selectedAlias: "alpha" }, [
      "alpha",
    ]);
    await f.contexts.select({ projectId: "b", selectedAlias: "beta" }, [
      "beta",
    ]);
    const results = await Promise.all(
      ["a", "b"].map((projectId) =>
        f.contexts.run({ projectId }, async () => {
          await Promise.resolve();
          return {
            ...(await f.contexts.settings()),
            key: f.contexts.key("history"),
          };
        }),
      ),
    );
    expect(results).toMatchObject([
      {
        defaultOrg: "alpha",
        projectRoot: "/alpha",
        key: "sf:project:a:history",
      },
      { defaultOrg: "beta", projectRoot: "/beta" },
    ]);
    expect(
      await f.contexts.resolve({
        projectId: "a",
        orgAlias: "override",
        projectRoot: "/evil",
      }),
    ).toMatchObject({
      targetSource: "override",
      settings: { defaultOrg: "override", projectRoot: "/alpha" },
    });
    expect(await f.contexts.settings()).toBe(f.settings);
    expect(f.contexts.key("history")).toBe("history");
    expect(f.contexts.isDx()).toBe(false);
    await f.contexts.select({ projectId: "a", selectedAlias: "" }, []);
    expect(await f.contexts.resolve({ projectId: "a" })).toMatchObject({
      targetSource: "shared",
    });
    f.settings.defaultOrg = "";
    expect(await f.contexts.resolve({})).toMatchObject({
      settings: { defaultOrg: "cli-default" },
    });
  });

  it("refuses unknown/unavailable projects and invalid targets", async () => {
    const f = fixture();
    for (const projectId of ["unknown", "remote", "missing"])
      await expect(f.contexts.resolve({ projectId })).rejects.toThrow();
    for (const orgAlias of ["--evil", "bad\nalias", "a".repeat(256)])
      await expect(f.contexts.resolve({ orgAlias })).rejects.toThrow("valid");
    await expect(f.contexts.select({}, [])).rejects.toThrow("Choose a project");
    await expect(
      f.contexts.select({ projectId: "a", selectedAlias: "bad" }, ["good"]),
    ).rejects.toThrow("connected org");
    expect(inputRecord([])).toEqual({});
    expect(inputText({ a: 3 }, "a")).toBe("");
    f.settings.defaultOrg = "";
    f.fallback.mockRejectedValue(Error("CLI missing"));
    expect(await f.contexts.resolve(null)).toMatchObject({
      settings: { defaultOrg: "" },
    });
  });
});

describe("workbench evidence and operations", () => {
  it("validates metadata and bounds/redacts public evidence", () => {
    for (const components of [
      [],
      ["--all"],
      ["ApexClass:*"],
      Array(51).fill("ApexClass:One"),
    ])
      expect(() => metadataSelection({ components })).toThrow();
    expect(
      metadataSelection({ components: ["ApexClass:One", "ApexClass:One"] }),
    ).toEqual(["ApexClass:One"]);
    const result = publicEvidence({
      token: "secret",
      child: { password: "private" },
      rows: Array(250).fill("x".repeat(20_000)),
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|private/);
    expect(JSON.stringify(result).length).toBeLessThan(65_000);
  });

  it("reads bounded records/logs/metadata without an agent and handles invalid input and API denial", async () => {
    const f = fixture();
    expect(
      await f.run(() =>
        f.service.record({
          objectName: "Account",
          recordId: "001000000000001",
        }),
      ),
    ).toMatchObject({ ok: true, record: { Name: "Acme" } });
    expect(
      JSON.stringify(
        await f.run(() =>
          f.service.record({
            objectName: "Account",
            recordId: "001000000000001",
          }),
        ),
      ),
    ).not.toContain("private");
    expect(
      await f.run(() => f.service.log({ logId: "07L000000000001" })),
    ).toMatchObject({ truncated: true });
    await expect(
      f.service.record({ objectName: "../Account", recordId: "x" }),
    ).rejects.toThrow("valid");
    await expect(f.service.log({ logId: "../bad" })).rejects.toThrow("valid");
    await expect(
      f.service.metadata({ metadataType: "unknown" }),
    ).rejects.toThrow("supported");
    f.sdk.execSf.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ result: Array(220).fill({ fullName: "One" }) }),
      stderr: "",
    });
    expect(await f.run(() => f.service.metadata({}))).toMatchObject({
      truncated: true,
    });
    f.sdk.confirm.mockResolvedValue({ approved: false, reason: "headless" });
    await expect(f.service.log({ logId: "07L000000000001" })).resolves.toMatchObject({ ok: true });
    expect(f.sdk.confirm).not.toHaveBeenCalled();
    f.sdk.confirm.mockResolvedValue({ approved: true, reason: "submitted" });
    f.sdk.request.mockResolvedValue({
      org: {} as never,
      response: { status: 403, json: {}, text: "denied" },
    });
    await expect(
      f.service.record({ objectName: "Account", recordId: "001000000000001" }),
    ).rejects.toThrow();
    await expect(f.service.log({ logId: "07L000000000001" })).rejects.toThrow();
    f.sdk.execSf.mockResolvedValue({
      code: 1,
      stdout: "bad json",
      stderr: "cli broke",
    });
    await expect(f.service.metadata({})).rejects.toThrow("cli broke");
    f.sdk.execSf.mockResolvedValue({
      code: 1,
      stdout: '{"message":"cli refused"}',
      stderr: "",
    });
    await expect(f.service.metadata({})).rejects.toThrow("cli refused");
  });

  it("pins deploy target and handles failed terminal reports after switching orgs", async () => {
    const f = fixture();
    f.sdk.execSf.mockResolvedValueOnce({
      code: 0,
      stdout: '{"result":{"id":"0Af000000000001"}}',
      stderr: "",
    });
    const { operation } = await f.run(() =>
      f.service.start({
        kind: "deploy.validate",
        components: ["ApexClass:One"],
        tests: ["OneTest"],
      }),
    );
    await f.settle();
    expect(f.sdk.execSf).toHaveBeenCalledWith(
      expect.arrayContaining([
        "start",
        "--dry-run",
        "--target-org",
        "shared",
        "--async",
        "--tests",
        "OneTest",
      ]),
      { cwd: "/alpha", timeoutMs: 120_000 },
    );
    f.settings.defaultOrg = "another";
    f.sdk.execSf.mockResolvedValue({
      code: 1,
      stdout:
        '{"status":1,"result":{"done":true,"success":false,"status":"Failed"}}',
      stderr: "",
    });
    expect(
      await f.run(() => f.service.report({ operationId: operation.id })),
    ).toMatchObject({
      operation: { state: "failed", org: { alias: "shared" } },
    });
    expect(f.sdk.execSf).toHaveBeenLastCalledWith(
      expect.arrayContaining(["--target-org", "shared"]),
    );
    await expect(
      f.run(() => f.service.report({ operationId: operation.id }), {
        projectId: "b",
      }),
    ).rejects.toThrow("No Salesforce job");
    f.sdk.confirm.mockResolvedValue({ approved: false, reason: "headless" });
    await expect(
      f.run(() => f.service.report({ operationId: operation.id })),
    ).resolves.toMatchObject({ ok: true });
  });

  it("runs targeted Apex/LWC, marks actual test failures, and preserves operation history", async () => {
    const f = fixture();
    f.apex.mockResolvedValue({
      ok: true,
      summary: "One failure",
      data: { numFailures: 1 },
    });
    await f.run(() =>
      f.service.start({ kind: "apex.test", className: "OneTest" }),
    );
    await f.settle();
    expect((await f.run(() => f.service.list())).operations[0]).toMatchObject({
      state: "failed",
      summary: "One failure",
    });
    await f.run(() =>
      f.service.start({ kind: "lwc.test", component: "myComponent" }),
    );
    await f.settle();
    expect(f.lwc).toHaveBeenCalledWith({
      action: "test.jest",
      component: "myComponent",
    });
    f.apex.mockResolvedValue({ ok: false, error: "Refused" } as never);
    await f.run(() =>
      f.service.start({ kind: "apex.anonymous", body: "System.debug(1);" }),
    );
    await f.settle();
    expect((await f.run(() => f.service.list())).operations[0]).toMatchObject({
      state: "failed",
      summary: "Refused",
    });
    expect(
      (await f.run(() => f.service.list(), { projectId: "b" })).operations,
    ).toEqual([]);
  });

  it("validates DX roots and tests, gates writes, and caps concurrent requests", async () => {
    const f = fixture();
    await expect(f.service.start({ kind: "bad" })).rejects.toThrow("supported");
    await expect(f.service.start({ kind: "deploy.preview" })).rejects.toThrow(
      "DX",
    );
    await expect(
      f.run(() =>
        f.service.start({
          kind: "deploy.start",
          components: ["ApexClass:One"],
          tests: [],
        }),
      ),
    ).rejects.toThrow("targeted");
    f.fs.readFile = () => '{"packageDirectories":[{"path":"escape"}]}';
    await expect(
      f.run(() => f.service.start({ kind: "retrieve.preview" })),
    ).rejects.toThrow("outside");
    f.fs.readFile = () => '{"packageDirectories":[{"path":"force-app"}]}';
    f.sdk.confirm.mockResolvedValue({ approved: false, reason: "headless" });
    await f.run(() =>
      f.service.start({
        kind: "retrieve.start",
        components: ["ApexClass:One"],
      }),
    );
    await f.settle();
    expect(f.sdk.confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "org.write",
        preview: expect.stringContaining("overwrite"),
      }),
      "",
    );
    expect(f.sdk.execSf).not.toHaveBeenCalled();
    let finish!: (value: never) => void;
    f.apex.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.all(
      Array.from({ length: 3 }, () =>
        f.run(() => f.service.start({ kind: "apex.test" })),
      ),
    );
    await expect(
      f.run(() => f.service.start({ kind: "apex.test" })),
    ).rejects.toThrow("Three");
    f.service.dispose();
    finish({ ok: true, summary: "done" } as never);
    await expect(f.service.start({ kind: "apex.test" })).rejects.toThrow();
  });

  it("restores interrupted operations and bounds stored history", async () => {
    const f = fixture();
    const row = {
      id: "old",
      projectId: "a",
      state: "running",
      org: { alias: "shared" },
    } as SalesforceOperation;
    await f.kv.set(
      "workbench:operations",
      Array.from({ length: 110 }, (_, i) => ({ ...row, id: String(i) })),
    );
    expect((await f.run(() => f.service.list())).operations).toHaveLength(30);
    expect((await f.run(() => f.service.list())).operations[0].state).toBe(
      "interrupted",
    );
    await f.run(() => f.service.start({ kind: "apex.test" }));
    await f.settle();
    expect(
      await f.kv.get<SalesforceOperation[]>("workbench:operations"),
    ).toHaveLength(100);
  });
});
