import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyWorkflowMigrations,
  attachCallThread,
  cancelRun,
  countCallsForRun,
  createRun,
  deleteTerminalRuns,
  getCall,
  getRunRequired,
  hasQueuedRun,
  incrementRepairAttempts,
  listCallsForRunPage,
  listExpiredTerminalRuns,
  migrations,
  queueCallProviderRetry,
  recoverInterruptedRuns,
  settleCall,
  settleRun,
  startCall,
  storeStructuredResult,
} from "./data.js";

describe("workflow durable data", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(migrations.join("\n"));
  });

  afterEach(() => db.close());

  function sweepExpired(now: number, limit: number): number {
    return deleteTerminalRuns(
      db,
      listExpiredTerminalRuns(db, now, limit).runIds,
    );
  }

  function newRun() {
    return createRun(db, {
      projectId: "project-1",
      originThreadId: "thread-1",
      environmentId: "environment-1",
      originProvider: "codex",
      originModel: "gpt-test",
      originReasoningLevel: "medium",
      originPermissionMode: "full",
      name: "test-workflow",
      source: "return null",
      sourceHash: "hash",
      argsJson: "null",
      settingsJson:
        '{"maxActiveRuns":4,"maxConcurrentAgents":8,"maxAgentCalls":100,"totalRunTimeoutMs":86400000,"retentionDays":30,"maxNotificationBytes":16384}',
      resumedFromRunId: null,
    });
  }

  function markRunning(runId: string): void {
    db.prepare(`UPDATE workflow_runs SET status = 'running' WHERE id = ?`).run(
      runId,
    );
  }

  const resolvedSelection = {
    providerId: "codex",
    model: "gpt-test",
    reasoningLevel: "medium",
    permissionMode: "full",
  } as const;

  it("records replay safety without a concurrency barrier", () => {
    const run = newRun();
    expect(getRunRequired(db, run.id)).toMatchObject({
      replaySafetyVersion: 1,
      replayBarrierIndex: null,
    });

    markRunning(run.id);
    expect(recoverInterruptedRuns(db)).toEqual([]);
    expect(getRunRequired(db, run.id)).toMatchObject({
      status: "queued",
      replaySafetyVersion: 1,
      replayBarrierIndex: null,
    });

    db.prepare(
      `UPDATE workflow_runs SET replay_safety_version = 0,
       replay_barrier_index = NULL WHERE id = ?`,
    ).run(run.id);
    expect(getRunRequired(db, run.id)).toMatchObject({
      replaySafetyVersion: 0,
      replayBarrierIndex: null,
    });
  });

  it("stores successful calls for deterministic replay", () => {
    const run = newRun();
    markRunning(run.id);
    const call = startCall(db, {
      runId: run.id,
      callIndex: 0,
      cacheKey: "cache",
      prompt: "inspect",
      options: {
        selection: null,
        outputSchema: null,
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    settleCall(db, {
      id: call.id,
      status: "succeeded",
      result: { answer: 42 },
      error: null,
    });

    expect(getCall(db, run.id, 0)).toMatchObject({
      cacheKey: "cache",
      optionsJson:
        '{"selection":null,"outputSchema":null,"title":null,"phase":null}',
      resolvedProvider: "codex",
      resolvedModel: "gpt-test",
      resolvedReasoningLevel: "medium",
      resolvedPermissionMode: "full",
      status: "succeeded",
      resultJson: '{"answer":42}',
      replaySource: null,
    });
  });

  it("persists provider retry attempts across worker replacements", () => {
    const run = newRun();
    markRunning(run.id);
    const call = startCall(db, {
      runId: run.id,
      callIndex: 0,
      cacheKey: "retry",
      prompt: "inspect",
      options: {
        selection: null,
        outputSchema: null,
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    expect(attachCallThread(db, call.id, "child-1")).toBe(true);
    settleCall(db, {
      id: call.id,
      status: "failed",
      result: null,
      error: "provider overloaded",
    });

    expect(
      queueCallProviderRetry(db, call.id, "provider overloaded"),
    ).toMatchObject({
      status: "queued",
      childThreadId: null,
      providerRetryAttempts: 1,
      error: "provider overloaded",
    });
    expect(attachCallThread(db, call.id, "child-2")).toBe(true);
    expect(getCall(db, run.id, 0)).toMatchObject({
      status: "running",
      childThreadId: "child-2",
      providerRetryAttempts: 1,
      error: null,
    });
  });

  it("pages calls by stable index and counts statuses without loading history", () => {
    const run = newRun();
    markRunning(run.id);
    const calls = [0, 1, 2].map((callIndex) =>
      startCall(db, {
        runId: run.id,
        callIndex,
        cacheKey: `cache-${callIndex}`,
        prompt: `inspect ${callIndex}`,
        options: {
          selection: null,
          outputSchema: null,
          title: null,
          phase: null,
        },
        selection: resolvedSelection,
        replay: null,
      }),
    );
    settleCall(db, {
      id: calls[0]!.id,
      status: "succeeded",
      result: "done",
      error: null,
    });
    settleCall(db, {
      id: calls[1]!.id,
      status: "failed",
      result: null,
      error: "failed",
    });
    expect(attachCallThread(db, calls[2]!.id, "child-2")).toBe(true);

    expect(
      listCallsForRunPage(db, {
        runId: run.id,
        afterCallIndex: -1,
        limit: 2,
      }).map((call) => call.callIndex),
    ).toEqual([0, 1]);
    expect(
      listCallsForRunPage(db, {
        runId: run.id,
        afterCallIndex: 1,
        limit: 2,
      }).map((call) => call.callIndex),
    ).toEqual([2]);
    expect(countCallsForRun(db, run.id)).toEqual({
      total: 3,
      queued: 0,
      running: 1,
      succeeded: 1,
      failed: 1,
      cancelled: 0,
    });
  });

  it("requeues interrupted runs and records orphan workers", () => {
    const run = newRun();
    markRunning(run.id);
    const call = startCall(db, {
      runId: run.id,
      callIndex: 0,
      cacheKey: "cache",
      prompt: "inspect",
      options: {
        selection: null,
        outputSchema: null,
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    db.prepare(
      `UPDATE workflow_calls SET status = 'running', child_thread_id = 'child-1' WHERE id = ?`,
    ).run(call.id);

    expect(recoverInterruptedRuns(db)).toEqual(["child-1"]);
    expect(getRunRequired(db, run.id).status).toBe("queued");
    expect(getCall(db, run.id, 0)).toMatchObject({
      status: "cancelled",
      error: "Plugin restarted",
    });
  });

  it("persists JSON null but requires it to rerun instead of replaying", () => {
    const first = newRun();
    markRunning(first.id);
    const original = startCall(db, {
      runId: first.id,
      callIndex: 0,
      cacheKey: "null-cache",
      prompt: "return null",
      options: {
        selection: null,
        outputSchema: null,
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    settleCall(db, {
      id: original.id,
      status: "succeeded",
      result: null,
      error: null,
    });
    expect(getCall(db, first.id, 0)?.resultJson).toBe("null");
    const second = createRun(db, {
      projectId: "project-1",
      originThreadId: "thread-1",
      environmentId: "environment-1",
      originProvider: "codex",
      originModel: "gpt-test",
      originReasoningLevel: "medium",
      originPermissionMode: "full",
      name: "test-workflow",
      source: "return null",
      sourceHash: "hash-2",
      argsJson: "null",
      settingsJson:
        '{"maxActiveRuns":4,"maxConcurrentAgents":8,"maxAgentCalls":100,"totalRunTimeoutMs":86400000,"retentionDays":30,"maxNotificationBytes":16384}',
      resumedFromRunId: first.id,
    });
    markRunning(second.id);
    startCall(db, {
      runId: second.id,
      callIndex: 0,
      cacheKey: "null-cache",
      prompt: "return null",
      options: {
        selection: null,
        outputSchema: null,
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });

    expect(getCall(db, second.id, 0)).toMatchObject({
      status: "queued",
      resultJson: null,
      replayedFromCallId: null,
    });
  });

  it("atomically preserves the first structured value", () => {
    const run = newRun();
    markRunning(run.id);
    const call = startCall(db, {
      runId: run.id,
      callIndex: 0,
      cacheKey: "structured",
      prompt: "answer",
      options: {
        selection: null,
        outputSchema: { type: "object" },
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    expect(attachCallThread(db, call.id, "child-structured")).toBe(true);

    expect(storeStructuredResult(db, call.id, { a: 1, b: 2 })).toBe("accepted");
    expect(storeStructuredResult(db, call.id, { b: 2, a: 1 })).toBe(
      "idempotent",
    );
    expect(storeStructuredResult(db, call.id, { a: 2, b: 1 })).toBe("conflict");
    expect(getCall(db, run.id, 0)?.resultJson).toBe('{"a":1,"b":2}');

    settleCall(db, {
      id: call.id,
      status: "succeeded",
      result: { a: 99 },
      error: null,
    });
    expect(storeStructuredResult(db, call.id, { b: 2, a: 1 })).toBe(
      "idempotent",
    );
    expect(storeStructuredResult(db, call.id, { a: 99 })).toBe("conflict");
  });

  it("uses one guarded repair counter and preserves accepted results on restart", () => {
    const run = newRun();
    markRunning(run.id);
    const call = startCall(db, {
      runId: run.id,
      callIndex: 0,
      cacheKey: "repair",
      prompt: "answer",
      options: {
        selection: null,
        outputSchema: { type: "number" },
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    attachCallThread(db, call.id, "child-repair");

    expect(incrementRepairAttempts(db, call.id)).toBe(1);
    expect(incrementRepairAttempts(db, call.id)).toBe(2);
    expect(storeStructuredResult(db, call.id, null)).toBe("accepted");
    expect(incrementRepairAttempts(db, call.id)).toBeNull();

    expect(recoverInterruptedRuns(db)).toEqual(["child-repair"]);
    expect(getRunRequired(db, run.id).status).toBe("queued");
    expect(getCall(db, run.id, 0)).toMatchObject({
      status: "succeeded",
      repairAttempts: 2,
      resultJson: "null",
      error: null,
    });
  });

  it("persists a successful run result of JSON null and keeps terminal transitions idempotent", () => {
    const run = newRun();
    expect(cancelRun(db, run.id)).toBe(true);
    expect(cancelRun(db, run.id)).toBe(false);
    expect(
      settleRun(db, {
        id: run.id,
        status: "succeeded",
        result: "too late",
        error: null,
      }),
    ).toEqual([]);
    expect(getRunRequired(db, run.id)).toMatchObject({
      status: "cancelled",
      resultJson: null,
    });

    const successful = newRun();
    markRunning(successful.id);
    settleRun(db, {
      id: successful.id,
      status: "succeeded",
      result: null,
      error: null,
    });
    expect(getRunRequired(db, successful.id)).toMatchObject({
      status: "succeeded",
      resultJson: "null",
    });
  });

  it("atomically cancels outstanding calls when a parent settles", () => {
    const run = newRun();
    markRunning(run.id);
    const call = startCall(db, {
      runId: run.id,
      callIndex: 0,
      cacheKey: "fire-and-forget",
      prompt: "slow",
      options: {
        selection: null,
        outputSchema: null,
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    db.prepare(
      `UPDATE workflow_calls SET status = 'running', child_thread_id = 'orphan' WHERE id = ?`,
    ).run(call.id);

    expect(
      settleRun(db, {
        id: run.id,
        status: "succeeded",
        result: "done",
        error: null,
      }),
    ).toMatchObject([{ id: call.id, childThreadId: "orphan" }]);
    expect(getRunRequired(db, run.id).status).toBe("succeeded");
    expect(getCall(db, run.id, 0)).toMatchObject({
      status: "cancelled",
      error: "Parent workflow finished before this call",
    });
  });

  it("allows call creation and attachment only while the parent is running", () => {
    const statuses = [
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
    ] as const;

    for (const status of statuses) {
      const creationRun = newRun();
      db.prepare(`UPDATE workflow_runs SET status = ? WHERE id = ?`).run(
        status,
        creationRun.id,
      );
      const create = () =>
        startCall(db, {
          runId: creationRun.id,
          callIndex: 0,
          cacheKey: `creation-${status}`,
          prompt: "state matrix",
          options: {
            selection: null,
            outputSchema: null,
            title: null,
            phase: null,
          },
          selection: resolvedSelection,
          replay: null,
        });
      if (status === "running") {
        expect(create).not.toThrow();
        expect(getCall(db, creationRun.id, 0)).toMatchObject({
          status: "queued",
        });
      } else {
        expect(create).toThrow("is not running");
        expect(getCall(db, creationRun.id, 0)).toBeNull();
      }

      const attachmentRun = newRun();
      markRunning(attachmentRun.id);
      const call = startCall(db, {
        runId: attachmentRun.id,
        callIndex: 0,
        cacheKey: `attachment-${status}`,
        prompt: "state matrix",
        options: {
          selection: null,
          outputSchema: null,
          title: null,
          phase: null,
        },
        selection: resolvedSelection,
        replay: null,
      });
      db.prepare(`UPDATE workflow_runs SET status = ? WHERE id = ?`).run(
        status,
        attachmentRun.id,
      );
      expect(attachCallThread(db, call.id, `matrix-child-${status}`)).toBe(
        status === "running",
      );
      expect(getCall(db, attachmentRun.id, 0)).toMatchObject({
        status: status === "running" ? "running" : "queued",
        childThreadId: status === "running" ? `matrix-child-${status}` : null,
      });
    }
  });

  function terminal(
    id: string,
    patch: { notificationSent: 0 | 1; finishedAt: number; retentionDays: number },
  ): void {
    db.prepare(
      `UPDATE workflow_runs SET status = 'succeeded', notification_sent = ?,
       finished_at = ?, settings_json = json_set(settings_json, '$.retentionDays', ?)
       WHERE id = ?`,
    ).run(patch.notificationSent, patch.finishedAt, patch.retentionDays, id);
  }

  function recursiveHistoryQueries(prepare: { mock: { calls: unknown[][] } }) {
    return prepare.mock.calls.filter(([sql]) =>
      /WITH RECURSIVE/i.test(String(sql)),
    );
  }

  it("expires notified runs at their own retention deadline", () => {
    const run = newRun();
    const finishedAt = Date.now() - 3 * 86_400_000;
    const deadline = finishedAt + 2 * 86_400_000;
    terminal(run.id, { notificationSent: 0, finishedAt, retentionDays: 2 });
    expect(sweepExpired(deadline, 100)).toBe(0);
    db.prepare(`UPDATE workflow_runs SET notification_sent = 1 WHERE id = ?`).run(
      run.id,
    );
    expect(sweepExpired(deadline - 1, 100)).toBe(0);
    expect(sweepExpired(deadline, 100)).toBe(1);
    expect(() => getRunRequired(db, run.id)).toThrow("Unknown workflow run");
  });

  it("skips the ancestry-aware history query while no terminal run is due", () => {
    const now = Date.now();
    const unnotified = newRun();
    terminal(unnotified.id, {
      notificationSent: 0,
      finishedAt: now - 9 * 86_400_000,
      retentionDays: 1,
    });
    const fresh = newRun();
    terminal(fresh.id, { notificationSent: 1, finishedAt: now, retentionDays: 30 });
    newRun();

    const prepare = vi.spyOn(db, "prepare");
    try {
      expect(listExpiredTerminalRuns(db, now, 100)).toEqual({
        runIds: [],
        childThreadIds: [],
      });
      expect(recursiveHistoryQueries(prepare)).toHaveLength(0);
    } finally {
      prepare.mockRestore();
    }
  });

  it("builds the ancestry-aware history query once a terminal run is due", () => {
    const now = Date.now();
    const due = newRun();
    terminal(due.id, {
      notificationSent: 1,
      finishedAt: now - 3 * 86_400_000,
      retentionDays: 1,
    });
    const prepare = vi.spyOn(db, "prepare");
    try {
      expect(listExpiredTerminalRuns(db, now, 100).runIds).toEqual([due.id]);
      expect(recursiveHistoryQueries(prepare)).toHaveLength(1);
    } finally {
      prepare.mockRestore();
    }
  });

  it("checks for due runs through the retention expression index", () => {
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT id FROM workflow_runs INDEXED BY workflow_runs_expiry_idx
         WHERE status IN ('succeeded', 'failed', 'cancelled') AND notification_sent = 1
         AND finished_at + json_extract(settings_json, '$.retentionDays') * 86400000 <= ? LIMIT 1`,
      )
      .all(Date.now()) as Array<{ detail: string }>;
    expect(plan.map((row) => row.detail).join("\n")).toMatch(
      /SEARCH .*workflow_runs_expiry_idx/,
    );
  });

  it("adds the retention expression index to an already-migrated database", () => {
    db.close();
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(migrations.slice(0, -1).join("\n"));
    const run = newRun();
    terminal(run.id, {
      notificationSent: 1,
      finishedAt: Date.now() - 3 * 86_400_000,
      retentionDays: 1,
    });
    const indexed = () =>
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'workflow_runs_expiry_idx'`,
        )
        .all();
    expect(indexed()).toHaveLength(0);
    db.exec(migrations.slice(-1).join("\n"));
    expect(indexed()).toHaveLength(1);
    // A host that replays the statement must not fail on the existing index.
    expect(() => db.exec(migrations.slice(-1).join("\n"))).not.toThrow();
    expect(sweepExpired(Date.now(), 100)).toBe(1);
  });

  it("reports queued runs with a bounded read-only existence probe", () => {
    expect(hasQueuedRun(db)).toBe(false);
    const running = newRun();
    markRunning(running.id);
    const finished = newRun();
    terminal(finished.id, {
      notificationSent: 1,
      finishedAt: Date.now(),
      retentionDays: 30,
    });
    expect(hasQueuedRun(db)).toBe(false);
    const queued = newRun();
    newRun();
    expect(hasQueuedRun(db)).toBe(true);
    db.prepare(`UPDATE workflow_runs SET status = 'cancelled' WHERE id = ?`).run(
      queued.id,
    );
    expect(hasQueuedRun(db)).toBe(true);
    db.prepare(`DELETE FROM workflow_runs WHERE status = 'queued'`).run();
    expect(hasQueuedRun(db)).toBe(false);
  });

  it("probes for queued runs with LIMIT 1 and never writes or opens a transaction", () => {
    const prepare = vi.spyOn(db, "prepare");
    const transaction = vi.spyOn(db, "transaction");
    try {
      newRun();
      prepare.mockClear();
      expect(hasQueuedRun(db)).toBe(true);
      const statements = prepare.mock.calls.map(([sql]) => String(sql));
      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatch(/^\s*SELECT\b/i);
      expect(statements[0]).toMatch(/\bLIMIT 1\s*$/i);
      expect(statements[0]).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i);
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      prepare.mockRestore();
      transaction.mockRestore();
    }
  });

  it("answers the queued-run probe from an existing status-prefixed covering index without scanning", () => {
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT 1 AS queued FROM workflow_runs WHERE status = 'queued' LIMIT 1`,
      )
      .all() as Array<{ detail: string }>;
    const detail = plan.map((row) => row.detail).join("\n");
    // The planner may pick either status-prefixed index (status, created_at) or
    // (status, notification_sent, finished_at); both answer it from the index alone.
    expect(detail).toMatch(
      /SEARCH workflow_runs USING COVERING INDEX workflow_runs_\w+_idx \(status=\?\)/,
    );
    expect(detail).not.toMatch(/\bSCAN\b/);
  });

  it("retains active resume ancestry while deleting unrelated expired runs", () => {
    const parent = newRun();
    db.prepare(
      `UPDATE workflow_runs SET status = 'succeeded', notification_sent = 1,
       finished_at = ?, settings_json = json_set(settings_json, '$.retentionDays', 1)
       WHERE id = ?`,
    ).run(Date.now() - 3 * 86_400_000, parent.id);
    const retainedChild = createRun(db, {
      projectId: "project-1",
      originThreadId: "thread-1",
      environmentId: "environment-1",
      originProvider: "codex",
      originModel: "gpt-test",
      originReasoningLevel: "medium",
      originPermissionMode: "full",
      name: "retained-child",
      source: "return null",
      sourceHash: "child-hash",
      argsJson: "null",
      settingsJson:
        '{"maxActiveRuns":4,"maxConcurrentAgents":8,"maxAgentCalls":100,"totalRunTimeoutMs":86400000,"retentionDays":1,"maxNotificationBytes":16384}',
      resumedFromRunId: parent.id,
    });
    const expired = newRun();
    db.prepare(
      `UPDATE workflow_runs SET status = 'failed', notification_sent = 1,
       finished_at = ?, settings_json = json_set(settings_json, '$.retentionDays', 1)
       WHERE id = ?`,
    ).run(Date.now() - 3 * 86_400_000, expired.id);

    expect(sweepExpired(Date.now(), 100)).toBe(1);
    expect(getRunRequired(db, parent.id).id).toBe(parent.id);
    expect(getRunRequired(db, parent.id).replayBarrierIndex).toBeNull();
    expect(getRunRequired(db, retainedChild.id).status).toBe("queued");
    expect(() => getRunRequired(db, expired.id)).toThrow(
      "Unknown workflow run",
    );
  });

  it("deletes an entirely expired resume chain in one bounded sweep", () => {
    const parent = newRun();
    const child = createRun(db, {
      projectId: "project-1",
      originThreadId: "thread-1",
      environmentId: "environment-1",
      originProvider: "codex",
      originModel: "gpt-test",
      originReasoningLevel: "medium",
      originPermissionMode: "full",
      name: "expired-child",
      source: "return null",
      sourceHash: "expired-child-hash",
      argsJson: "null",
      settingsJson:
        '{"maxActiveRuns":4,"maxConcurrentAgents":8,"maxAgentCalls":100,"totalRunTimeoutMs":86400000,"retentionDays":1,"maxNotificationBytes":16384}',
      resumedFromRunId: parent.id,
    });
    db.prepare(
      `UPDATE workflow_runs SET status = 'succeeded', notification_sent = 1,
       finished_at = ?, settings_json = json_set(settings_json, '$.retentionDays', 1)
       WHERE id IN (?, ?)`,
    ).run(Date.now() - 3 * 86_400_000, parent.id, child.id);

    expect(sweepExpired(Date.now(), 100)).toBe(2);
    expect(() => getRunRequired(db, parent.id)).toThrow("Unknown workflow run");
    expect(() => getRunRequired(db, child.id)).toThrow("Unknown workflow run");
  });
});

describe("applyWorkflowMigrations", () => {
  it("passes the full migration list in one host migrate() call", () => {
    const calls: string[][] = [];
    applyWorkflowMigrations({
      migrate(statements) {
        calls.push([...statements]);
      },
    });
    expect(calls).toEqual([[...migrations]]);
  });

  it("tolerates hosts that re-exec ALTER ADD COLUMN on every load", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(migrations[0]!);
    sqlite.exec(migrations[1]!);
    const database = {
      migrate(statements: readonly string[]) {
        sqlite.exec(statements.join("\n"));
      },
    };
    applyWorkflowMigrations(database);
    applyWorkflowMigrations(database);
    sqlite
      .prepare(
        `INSERT INTO workflow_runs (
      id, project_id, origin_thread_id, environment_id, origin_provider, origin_model,
      origin_reasoning_level, origin_permission_mode, name, source, source_hash, args_json,
      status, notification_sent, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        "wfr_live",
        "project-1",
        "thread-1",
        "env-1",
        "codex",
        "gpt-test",
        "medium",
        "full",
        "live",
        "return null",
        "hash",
        "null",
        "queued",
        Date.now(),
      );
    expect(
      sqlite.prepare("SELECT settings_json FROM workflow_runs WHERE id = ?").get("wfr_live"),
    ).toMatchObject({
      settings_json: expect.stringContaining("maxActiveRuns"),
    });
    sqlite.close();
  });
});
