import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk/server";
import { z } from "zod";
import { registerWorkflowCli } from "./cli.js";
import { applyWorkflowMigrations, wrapPluginDatabase } from "./data.js";
import { toJsonValue } from "./json-value.js";
import { createWorkflowService } from "./service.js";
import {
  DEFAULT_WORKFLOW_SETTINGS,
  registerWorkflowSettings,
} from "./settings.js";
import type { JsonValue } from "./types.js";
import { prepareWorkflowSource } from "./workflow-input.js";
import { workflowUiRpcContract } from "./ui-contract.js";
import { buildWorkflowRunView } from "./ui-view.js";

const sourceInputFields = {
  script: z
    .string()
    .min(1)
    .describe(
      "Self-contained workflow script. Must begin with `export const meta = { name, description, phases }` (pure literal, no computed values) followed by the script body using agent()/parallel()/pipeline()/phase().",
    )
    .optional(),
  source: z
    .string()
    .min(1)
    .describe("Alias for `script`. Do not provide both `source` and `script`.")
    .optional(),
  scriptPath: z
    .string()
    .min(1)
    .describe(
      "Path to a workflow script file on the origin environment's host. Relative paths start at the workspace root and all paths must remain inside that workspace.",
    )
    .optional(),
  name: z
    .string()
    .min(1)
    .describe(
      "Name of a saved workflow from the current workspace's .zcc/workflows/ directory. Resolves to a self-contained script.",
    )
    .optional(),
} as const;
const freeformJson = z.unknown();

const runInputSchema = z
  .object({
    ...sourceInputFields,
    args: freeformJson
      .describe(
        "Optional input value exposed to the script as the global `args`, verbatim. Pass arrays/objects as actual JSON values, NOT as a JSON-encoded string — a stringified list breaks `args.filter`/`args.map` in the script. Use for parameterized named workflows (e.g. a research question).",
      )
      .default(null),
    resumeRunId: z
      .string()
      .min(1)
      .nullable()
      .describe(
        "Run ID of a prior ZCC workflow to resume from. Calls in the causally safe, longest unchanged prefix return cached results; the first edited, new, or concurrent call and everything after it run live. The prior run must be terminal and from the same project and environment.",
      )
      .default(null),
  })
  .strict();
const resultInputSchema = z
  .object({
    value: freeformJson.describe(
      "The final value matching the requested JSON Schema.",
    ),
  })
  .strict();

function jsonResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function errorResult(error: string): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return { content: [{ type: "text", text: error }], isError: true };
}

export default async function plugin(zcc: ZccPluginApi) {
  const settings = registerWorkflowSettings(zcc);
  const rawDb = zcc.storage.database();
  const db = wrapPluginDatabase(rawDb);
  applyWorkflowMigrations(rawDb);
  let initialSettings = DEFAULT_WORKFLOW_SETTINGS;
  try {
    initialSettings = await settings.get();
  } catch (error) {
    zcc.status.needsConfiguration(
      `Workflow settings are invalid; defaults are active until the settings are corrected: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const service = createWorkflowService(zcc, db, initialSettings);
  settings.onChange(
    (next) => service.updateSettings(next),
    (error) =>
      zcc.status.needsConfiguration(
        `Workflow settings are invalid; the last valid values remain active: ${error.message}`,
      ),
  );
  registerWorkflowCli(zcc, service);

  function workflowForThread(threadId: string, runId: string | null) {
    const run =
      runId === null
        ? service.inspectLatestForThread(threadId)
        : service.inspect(runId);
    if (run === null) return null;
    if (run.originThreadId !== threadId) {
      throw new Error("This workflow run is not available in this thread");
    }
    return run;
  }

  zcc.rpc.register(workflowUiRpcContract, {
    workflowActiveRuns({ threadId }) {
      return {
        runs: service
          .inspectActiveForThread(threadId)
          .map(buildWorkflowRunView),
      };
    },
    workflowRunView({ threadId, runId }) {
      const run = workflowForThread(threadId, runId);
      return { run: run === null ? null : buildWorkflowRunView(run) };
    },
    async workflowStopRun({ threadId, runId }) {
      const run = workflowForThread(threadId, runId);
      if (run === null) throw new Error(`Unknown workflow run ${runId}`);
      const stopped = await service.stop(run.id);
      const latest = workflowForThread(threadId, run.id);
      if (latest === null) throw new Error(`Unknown workflow run ${runId}`);
      return { stopped, run: buildWorkflowRunView(latest) };
    },
  });

  zcc.agents.registerTool({
    name: "zcc_workflow_run",
    presentation: {
      label: { pending: "Starting workflow", completed: "Started workflow" },
      icon: { glyph: "GitBranch" },
    },
    description:
      "Execute a workflow script that orchestrates multiple subagents deterministically. Workflows run in the background — this tool returns immediately with a run ID and a `previewDirective`. After a successful call, emit that directive exactly once on its own line (not in a code fence) so ZCC renders live progress in chat. A completion notification is sent to the origin thread. Use `zcc workflows status <run-id>` for a compact summary. For detailed history, redirect a bounded JSONL page from `zcc workflows history <run-id> --cursor <call-index> --limit <1-100>` into `$ZCC_THREAD_STORAGE` or `$BB_THREAD_STORAGE`, then inspect the file with normal filesystem tools.",
    parameters: runInputSchema,
    async execute(raw, ctx) {
      try {
        const input = runInputSchema.parse(raw);
        const prepared = await prepareWorkflowSource(zcc, ctx, input);
        const run = await service.start({
          projectId: ctx.projectId,
          originThreadId: ctx.threadId,
          source: prepared.source,
          args: toJsonValue(input.args, "args"),
          resumedFromRunId: input.resumeRunId,
        });
        const previewDirective = `::workflow-preview{run="${run.id}"}`;
        return jsonResult({
          runId: run.id,
          status: run.status,
          name: run.name,
          previewDirective,
        });
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  });

  zcc.agents.registerTool({
    name: "zcc_workflow_result",
    presentation: {
      label: {
        pending: "Returning structured result",
        completed: "Returned structured result",
      },
      icon: { glyph: "GitBranch" },
      suppress: true,
    },
    description:
      'Use this tool to return your final response in the requested structured format. You MUST call this tool exactly once at the end of your response with {"value": ...} to provide the structured output.',
    parameters: resultInputSchema,
    async execute(raw, ctx) {
      let parsed: JsonValue;
      try {
        parsed = toJsonValue(resultInputSchema.parse(raw).value, "value");
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error),
        );
      }
      const result = await service.submitStructuredResult(ctx.threadId, parsed);
      if (result.ok) return jsonResult({ accepted: true });
      return errorResult(result.error);
    },
  });

  zcc.agents.configure((context) => {
    const threadId = context.thread?.id ?? context.threadId;
    if (threadId) {
      const worker = service.agentConfiguration(threadId);
      if (worker !== null) {
        return {
          tools:
            worker.terminal || worker.resultParameters === null
              ? []
              : [
                  {
                    name: "zcc_workflow_result",
                    parameters: worker.resultParameters,
                  },
                ],
          skills: [],
          ...(worker.instructions === null
            ? {}
            : { instructions: worker.instructions }),
        };
      }
    }
    if (context.origin?.pluginId === zcc.pluginId) {
      return {
        tools: ["zcc_workflow_result"],
        skills: [],
        instructions:
          "You are starting as a ZCC workflow worker. Follow the workflow prompt. Your final text IS the return value, not a human-facing message. If the prompt requests structured output, call zcc_workflow_result exactly once at the end of your response.",
      };
    }
    return {
      tools: ["zcc_workflow_run"],
      skills: ["workflows"],
      instructions:
        "When zcc_workflow_run succeeds, copy its previewDirective into your response exactly once as a standalone line. Do not wrap it in backticks or a code fence, and do not invent or edit the run ID. The directive renders live workflow progress in ZCC chat. `zcc workflows status <run-id>` returns a compact summary. For detailed history, redirect `zcc workflows history <run-id> --cursor <call-index> --limit <1-100>` into a file under `$ZCC_THREAD_STORAGE` or `$BB_THREAD_STORAGE`, then inspect that JSONL file with normal filesystem tools. Use each page record's `nextCursor` to continue.",
    };
  });

  zcc.events.on("thread.idle", (event) => {
    service.onThreadIdle(event.threadId, event.lastAssistantText ?? null);
  });
  zcc.events.on("thread.failed", (event) => {
    service.onThreadFailed(event.threadId, event.error ?? "thread failed");
  });
  zcc.events.on("thread.deleted", (event) => {
    service.onThreadDeleted(event.threadId);
  });

  const workerAbort = new AbortController();
  zcc.background.service("workflow-worker", () => {
    void service.runWorker(workerAbort.signal);
    return () => workerAbort.abort();
  });
}
