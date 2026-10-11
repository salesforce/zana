import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { getEventListeners } from "node:events";
import { createFakePluginHost } from "@zana-ai/zcc-plugin-sdk/testing";
import type { PluginDatabase } from "@zana-ai/zcc-plugin-sdk/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyWorkflowMigrations,
  createRun,
  getRun,
  getRunRequired,
  wrapPluginDatabase,
} from "./data.js";
import { createWorkflowService } from "./service.js";
import { DEFAULT_WORKFLOW_SETTINGS, type WorkflowSettings } from "./settings.js";

const DAY_MS = 86_400_000;

function source(body: string): string {
  return `export const meta = { name: "wake-test", description: "Wake test" };\n${body}\n`;
}

function memoryPluginDatabase(sqlite: Database.Database): PluginDatabase {
  return {
    runScript: (sql) => void sqlite.exec(sql),
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        all: (...params) => statement.all(...params),
        get: (...params) => statement.get(...params),
        run: (...params) => ({ changes: statement.run(...params).changes }),
      };
    },
    migrate: (statements) => void sqlite.exec(statements.join(";\n")),
    transaction: (fn) => sqlite.transaction(fn)(),
  };
}

describe("workflow worker wake-up", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    vi.useRealTimers();
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  function setup(settings: WorkflowSettings = DEFAULT_WORKFLOW_SETTINGS) {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const rawDb = memoryPluginDatabase(sqlite);
    applyWorkflowMigrations(rawDb);
    const db = wrapPluginDatabase(rawDb);
    const spawned: string[] = [];
    const sent: Array<{ threadId: string }> = [];
    const origin = {
      id: "thread-origin",
      projectId: "project-1",
      hostId: "host-1",
      environmentId: "env-1",
      providerId: "fake",
      status: "idle",
    };
    const { zcc, harness } = createFakePluginHost({
      pluginId: "workflows",
      database: rawDb,
      // Workers stay "active" until the test reports them idle, or maintenance would complete them.
      getThread: async ({ threadId }) => ({
        ...origin,
        id: threadId,
        status: threadId.startsWith("child-") ? "active" : "idle",
      }),
      defaultExecutionOptions: async () => ({
        model: "gpt-test",
        reasoningLevel: "medium",
        permissionMode: "full",
      }),
      listProviders: async () => [
        {
          id: "fake",
          available: true,
          capabilities: { permissionModes: ["full"] },
        },
      ],
      loadProviderModels: async () => ({
        models: [
          {
            id: "gpt-test",
            model: "gpt-test",
            supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
          },
        ],
        selectedOnlyModels: [],
        modelLoadError: null,
      }),
      spawnThread: async () => {
        const id = `child-${spawned.length + 1}`;
        spawned.push(id);
        return { id };
      },
      stopThread: async () => ({ ok: true as const }),
      threadOutput: async () => ({ output: "done" }),
      sendThread: async ({ threadId }) => {
        sent.push({ threadId });
        return { id: `message-${sent.length}` };
      },
      archiveThread: async ({ threadId }) => ({ id: threadId }),
    });
    cleanups.push(async () => {
      await harness.dispose();
      sqlite.close();
    });
    const service = createWorkflowService(zcc, db, settings);
    return {
      db,
      sqlite,
      service,
      spawned,
      sent,
      /** Queues a run straight into the table, the way another process or a migration would: no wake. */
      insertQueued: (body: string) => {
        const text = source(body);
        return createRun(db, {
          projectId: "project-1",
          originThreadId: "thread-origin",
          environmentId: "env-1",
          originProvider: "fake",
          originModel: "gpt-test",
          originReasoningLevel: "medium",
          originPermissionMode: "full",
          name: "wake-test",
          source: text,
          sourceHash: createHash("sha256").update(text).digest("hex"),
          argsJson: "null",
          settingsJson: JSON.stringify(settings),
          resumedFromRunId: null,
        });
      },
      start: (body: string) =>
        service.start({
          projectId: "project-1",
          originThreadId: "thread-origin",
          source: source(body),
          args: null,
          resumedFromRunId: null,
        }),
    };
  }

  /** Runs `body` with a worker, then aborts it and waits for a clean shutdown. */
  async function withWorker(
    service: ReturnType<typeof setup>["service"],
    body: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const controller = new AbortController();
    const worker = service.runWorker(controller.signal);
    try {
      await body(controller.signal);
    } finally {
      controller.abort();
      await worker;
    }
  }

  it("waits without claim transactions and wakes immediately for a new run", async () => {
    const test = setup();
    vi.useFakeTimers();
    const transactions = vi.spyOn(test.db, "transaction");
    await withWorker(test.service, async () => {
      await vi.advanceTimersByTimeAsync(0);
      transactions.mockClear();
      await vi.advanceTimersByTimeAsync(2_200);
      expect(transactions).not.toHaveBeenCalled();
      const run = await test.start('return "awake";');
      await vi.waitFor(
        () => expect(getRunRequired(test.db, run.id).status).toBe("succeeded"),
        { timeout: 200, interval: 10 },
      );
      await vi.waitFor(
        () =>
          expect(getRunRequired(test.db, run.id).notificationSent).toBe(true),
        { timeout: 200, interval: 10 },
      );
    });
    transactions.mockRestore();
  });

  it.each(["settings", "completion", "cancellation"] as const)(
    "wakes queued runs when %s frees capacity",
    async (change) => {
      const test = setup({ ...DEFAULT_WORKFLOW_SETTINGS, maxActiveRuns: 1 });
      const first = await test.start('return await agent("held");');
      const second = await test.start('return "next";');
      vi.useFakeTimers();
      await withWorker(test.service, async () => {
        await vi.waitFor(() => expect(test.spawned).toHaveLength(1), {
          timeout: 200,
          interval: 1,
        });
        await vi.advanceTimersByTimeAsync(100);
        expect(getRunRequired(test.db, second.id).status).toBe("queued");
        if (change === "settings") {
          test.service.updateSettings({
            ...DEFAULT_WORKFLOW_SETTINGS,
            maxActiveRuns: 2,
          });
        } else if (change === "completion") {
          test.service.onThreadIdle("child-1", "done");
        } else {
          await test.service.stop(first.id);
        }
        await vi.waitFor(
          () =>
            expect(getRunRequired(test.db, second.id).status).toBe(
              "succeeded",
            ),
          { timeout: 20, interval: 1 },
        );
      });
    },
  );

  it("keeps running scheduled maintenance without any wake", async () => {
    const test = setup();
    vi.useFakeTimers();
    const now = Date.now();
    const expiring = await test.start('return "old";');
    // Retention deadline 700 ms from now, so only a later maintenance tick can delete it.
    test.sqlite
      .prepare(
        `UPDATE workflow_runs SET status = 'succeeded', notification_sent = 1,
         finished_at = ?, settings_json = json_set(settings_json, '$.retentionDays', 1)
         WHERE id = ?`,
      )
      .run(now - DAY_MS + 700, expiring.id);
    const retrying = await test.start('return "retry";');
    test.sqlite
      .prepare(
        `UPDATE workflow_runs SET status = 'succeeded', notification_sent = 0,
         notification_attempt_count = 1, notification_next_attempt_at = ?,
         finished_at = ? WHERE id = ?`,
      )
      .run(now + 600, now, retrying.id);
    await withWorker(test.service, async () => {
      await vi.advanceTimersByTimeAsync(0);
      expect(getRun(test.db, expiring.id)).not.toBeNull();
      expect(getRunRequired(test.db, retrying.id).notificationSent).toBe(false);
      await vi.advanceTimersByTimeAsync(1_100);
      expect(getRun(test.db, expiring.id)).toBeNull();
      expect(getRunRequired(test.db, retrying.id).notificationSent).toBe(true);
    });
  });

  it("releases its timer and abort listener on every wake and on shutdown", async () => {
    const test = setup();
    vi.useFakeTimers();
    const controller = new AbortController();
    const baseline = getEventListeners(controller.signal, "abort").length;
    const worker = test.service.runWorker(controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    const waiting = getEventListeners(controller.signal, "abort").length;
    expect(waiting).toBeGreaterThan(baseline);
    for (let wake = 0; wake < 25; wake += 1) {
      test.service.updateSettings(DEFAULT_WORKFLOW_SETTINGS);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(waiting);
    controller.abort();
    await worker;
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores wake requests while no worker is running", async () => {
    const test = setup();
    const run = await test.start('return "queued";');
    expect(() => test.service.updateSettings(DEFAULT_WORKFLOW_SETTINGS)).not.toThrow();
    await expect(test.service.stop("wfr_missing")).resolves.toBe(false);
    expect(getRunRequired(test.db, run.id).status).toBe("queued");
    // A request made before the worker exists is honoured by its first pass.
    vi.useFakeTimers();
    await withWorker(test.service, async () => {
      await vi.waitFor(
        () => expect(getRunRequired(test.db, run.id).status).toBe("succeeded"),
        { timeout: 200, interval: 10 },
      );
    });
  });
  describe("stranded queued runs", () => {
    const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i;
    const QUEUED_PROBE = /SELECT 1 AS queued FROM workflow_runs WHERE status = 'queued' LIMIT 1/;

    it("claims a queued run inserted without a wake on the next maintenance tick", async () => {
      const test = setup();
      vi.useFakeTimers();
      await withWorker(test.service, async () => {
        await vi.advanceTimersByTimeAsync(0);
        const run = test.insertQueued('return "stranded";');
        // Nothing woke the worker and the next tick is still ~1 s away.
        await vi.advanceTimersByTimeAsync(900);
        expect(getRunRequired(test.db, run.id).status).toBe("queued");
        await vi.advanceTimersByTimeAsync(200);
        await vi.waitFor(
          () => expect(getRunRequired(test.db, run.id).status).toBe("succeeded"),
          { timeout: 200, interval: 10 },
        );
      });
    });

    it("claims a run whose claim was blocked by a foreign running row once capacity frees without a wake", async () => {
      const test = setup({ ...DEFAULT_WORKFLOW_SETTINGS, maxActiveRuns: 1 });
      vi.useFakeTimers();
      await withWorker(test.service, async () => {
        await vi.advanceTimersByTimeAsync(0);
        // Another process holds the only slot; this worker has no execution of its own.
        const foreign = test.insertQueued('return "foreign";');
        test.sqlite
          .prepare(
            `UPDATE workflow_runs SET status = 'running', started_at = ? WHERE id = ?`,
          )
          .run(Date.now(), foreign.id);
        const stranded = test.insertQueued('return "stranded";');
        await vi.advanceTimersByTimeAsync(2_200);
        expect(getRunRequired(test.db, stranded.id).status).toBe("queued");
        // Capacity frees through a path that never calls wakeWorker().
        test.sqlite
          .prepare(
            `UPDATE workflow_runs SET status = 'succeeded', finished_at = ? WHERE id = ?`,
          )
          .run(Date.now(), foreign.id);
        await vi.advanceTimersByTimeAsync(1_100);
        await vi.waitFor(
          () =>
            expect(getRunRequired(test.db, stranded.id).status).toBe("succeeded"),
          { timeout: 200, interval: 10 },
        );
      });
    });

    it("claims queued runs that predate the worker on its first pass", async () => {
      const test = setup();
      const queued = test.insertQueued('return "before-start";');
      // A run a crashed process left mid-flight is requeued by recovery, then claimed too.
      const interrupted = test.insertQueued('return "interrupted";');
      test.sqlite
        .prepare(
          `UPDATE workflow_runs SET status = 'running', started_at = ? WHERE id = ?`,
        )
        .run(Date.now(), interrupted.id);
      vi.useFakeTimers();
      await withWorker(test.service, async () => {
        await vi.advanceTimersByTimeAsync(0);
        await vi.waitFor(
          () => {
            expect(getRunRequired(test.db, queued.id).status).toBe("succeeded");
            expect(getRunRequired(test.db, interrupted.id).status).toBe(
              "succeeded",
            );
          },
          { timeout: 200, interval: 10 },
        );
      });
    });

    it("performs no claim transaction and no write on idle ticks, only the read-only probe", async () => {
      const test = setup();
      vi.useFakeTimers();
      const transactions = vi.spyOn(test.db, "transaction");
      const prepare = vi.spyOn(test.sqlite, "prepare");
      await withWorker(test.service, async () => {
        await vi.advanceTimersByTimeAsync(0);
        transactions.mockClear();
        prepare.mockClear();
        await vi.advanceTimersByTimeAsync(3_100);
        const statements = prepare.mock.calls.map(([sql]) => String(sql));
        expect(transactions).not.toHaveBeenCalled();
        expect(statements.filter((sql) => WRITE_SQL.test(sql))).toEqual([]);
        // One probe per maintenance tick (about one a second), nothing heavier.
        const probes = statements.filter((sql) => QUEUED_PROBE.test(sql));
        expect(probes.length).toBeGreaterThanOrEqual(3);
        expect(probes.length).toBeLessThanOrEqual(4);
        expect(
          statements.filter((sql) => /status = 'queued'/.test(sql) && !QUEUED_PROBE.test(sql)),
        ).toEqual([]);
      });
      transactions.mockRestore();
      prepare.mockRestore();
    });

    it("does not probe or attempt claims while every slot is busy", async () => {
      const test = setup({ ...DEFAULT_WORKFLOW_SETTINGS, maxActiveRuns: 1 });
      const first = await test.start('return await agent("held");');
      const second = await test.start('return "next";');
      vi.useFakeTimers();
      await withWorker(test.service, async () => {
        await vi.waitFor(() => expect(test.spawned).toHaveLength(1), {
          timeout: 200,
          interval: 1,
        });
        await vi.advanceTimersByTimeAsync(100);
        expect(getRunRequired(test.db, first.id).status).toBe("running");
        const transactions = vi.spyOn(test.db, "transaction");
        const prepare = vi.spyOn(test.sqlite, "prepare");
        await vi.advanceTimersByTimeAsync(3_100);
        const statements = prepare.mock.calls.map(([sql]) => String(sql));
        expect(statements.filter((sql) => QUEUED_PROBE.test(sql))).toEqual([]);
        expect(
          statements.filter((sql) => /status = 'queued'/.test(sql) && /ORDER BY created_at/.test(sql)),
        ).toEqual([]);
        expect(getRunRequired(test.db, second.id).status).toBe("queued");
        transactions.mockRestore();
        prepare.mockRestore();
      });
    });

    it("keeps maintenance running when the queued probe throws", async () => {
      const test = setup();
      vi.useFakeTimers();
      const prepare = vi.spyOn(test.sqlite, "prepare");
      await withWorker(test.service, async () => {
        await vi.advanceTimersByTimeAsync(0);
        let failedProbes = 0;
        prepare.mockImplementation(function (this: Database.Database, sql: string) {
          if (QUEUED_PROBE.test(sql)) {
            failedProbes += 1;
            throw new Error("probe failed");
          }
          return Database.prototype.prepare.call(this, sql);
        } as never);
        await vi.advanceTimersByTimeAsync(1_100);
        prepare.mockRestore();
        expect(failedProbes).toBeGreaterThanOrEqual(1);
        // The worker survived the failed probe and still serves a normal wake.
        const run = await test.start('return "after-error";');
        await vi.waitFor(
          () => expect(getRunRequired(test.db, run.id).status).toBe("succeeded"),
          { timeout: 200, interval: 10 },
        );
      });
    });
  });
});
