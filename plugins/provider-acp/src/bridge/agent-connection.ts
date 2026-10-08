/**
 * Minimal JSON-RPC 2.0 endpoint over a spawned ACP agent's stdio.
 *
 * ACP frames messages as newline-delimited JSON. ZCC only consumes a small,
 * stable subset of the protocol, so the bridge validates traffic with the
 * schemas in `../wire.ts` instead of depending on an external ACP SDK.
 */

import type { ChildProcess } from "node:child_process";
import { experimental_spawnPortablePipedProcess as spawnPortablePipedProcess } from "@zana-ai/zcc-plugin-sdk/provider-bridge";
import { experimental_readBoundedLines, experimental_recordProviderChildIo } from "@zana-ai/zcc-plugin-sdk/provider-bridge";
import type { z } from "zod";

const STDERR_TAIL_MAX_BYTES = 64 * 1024;
const CLOSE_AFTER_EXIT_GRACE_MS = 1_000;
const KILL_ESCALATION_MS = 4_000;

export interface AcpAgentRequestResponder {
  result(value: unknown): void;
  error(code: number, message: string): void;
}

export interface AcpAgentExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string;
}

export interface CreateAcpAgentConnectionOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  /**
   * The thread this agent serves, for record mode; null for process-level
   * agents (model discovery).
   */
  recordThreadId: string | null;
  onNotification(method: string, params: unknown): void;
  onRequest(
    method: string,
    params: unknown,
    responder: AcpAgentRequestResponder,
  ): void;
  onExit(info: AcpAgentExitInfo): void;
}

export interface AcpAgentRequestArgs<TResult> {
  method: string;
  params: unknown;
  resultSchema: z.ZodType<TResult>;
}

export interface AcpAgentConnection {
  request<TResult>(args: AcpAgentRequestArgs<TResult>): Promise<TResult>;
  notify(method: string, params: unknown): void;
  kill(): Promise<void>;
  readonly exited: boolean;
}

export class AcpAgentExitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcpAgentExitedError";
  }
}

export function formatAcpLaunchFailure(command: string, error: Error): string {
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const missing = code === "ENOENT" || /\bENOENT\b/.test(error.message);
  if (!missing) {
    return `Failed to launch ACP agent "${command}": ${error.message}`;
  }
  const base = command.replace(/\\/g, "/").split("/").pop() ?? command;
  const name =
    base === "opencode"
      ? "OpenCode"
      : base === "cursor-agent" || base === "agent"
        ? "Cursor"
        : base;
  return `${name} is not installed on this machine (command "${command}" was not found). Install it on this host, or pick another agent.`;
}

interface PendingAgentRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface ParsedAgentMessage {
  id?: string | number;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string };
  params?: unknown;
}

function parseAgentLine(line: string): ParsedAgentMessage | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as ParsedAgentMessage;
}

export function createAcpAgentConnection(
  options: CreateAcpAgentConnectionOptions,
): AcpAgentConnection {
  const child: ChildProcess = spawnPortablePipedProcess({
    command: options.command, args: options.args,
    cwd: options.cwd,
    env: options.env,
  });
  experimental_recordProviderChildIo(child, {
    threadId: options.recordThreadId,
  });

  const pending = new Map<number, PendingAgentRequest>();
  let stderrTail = Buffer.alloc(0);
  let nextRequestId = 1;
  let exited = false;
  let protocolFailed = false;
  let exitStatus: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  let closeGraceTimer: NodeJS.Timeout | null = null;
  let killEscalation: NodeJS.Timeout | null = null;
  let resolveExit!: () => void;
  const exitPromise = new Promise<void>((resolve) => { resolveExit = resolve; });

  function appendStderr(chunk: Buffer | string): void {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    if (bytes.length >= STDERR_TAIL_MAX_BYTES) {
      stderrTail = Buffer.from(bytes.subarray(bytes.length - STDERR_TAIL_MAX_BYTES));
    } else {
      stderrTail = Buffer.concat([
        stderrTail.subarray(Math.max(0, stderrTail.length + bytes.length - STDERR_TAIL_MAX_BYTES)), bytes,
      ]);
    }
  }

  function finalizeExit(status: { code: number | null; signal: NodeJS.Signals | null }): void {
    if (exited) return;
    exited = true;
    if (closeGraceTimer !== null) clearTimeout(closeGraceTimer);
    if (killEscalation !== null) clearTimeout(killEscalation);
    child.stdout?.destroy();
    child.stderr?.destroy();
    const tail = stderrTail.toString("utf8");
    rejectAllPending(new AcpAgentExitedError(
      `ACP agent "${options.command}" exited (code ${status.code ?? "null"}, signal ${status.signal ?? "null"})${tail ? `: ${tail}` : ""}`,
    ));
    try {
      options.onExit({ ...status, stderrTail: tail });
    } finally {
      resolveExit();
    }
  }

  function writeLine(message: object): void {
    const stdin = child.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) {
      return;
    }
    stdin.write(JSON.stringify(message) + "\n");
  }

  function rejectAllPending(error: Error): void {
    for (const [, request] of pending) {
      request.reject(error);
    }
    pending.clear();
  }

  if (child.stdout) {
    experimental_readBoundedLines({
      input: child.stdout,
      onOverflow: (bytes) => {
        protocolFailed = true;
        appendStderr(`\nACP agent stdout frame exceeded its byte cap (${bytes} bytes)\n`);
        child.kill("SIGKILL");
      },
      onLine: (line) => {
        if (exited || protocolFailed) return;
        const message = parseAgentLine(line);
        if (!message) {
          return;
        }

        const id = message.id;
        if (
          (typeof id === "string" || typeof id === "number") &&
          message.method === undefined
        ) {
          const numericId = typeof id === "number" ? id : Number(id);
          const request = pending.get(numericId);
          if (!request) {
            return;
          }
          pending.delete(numericId);
          if (message.error) {
            request.reject(
              new Error(
                message.error.message ??
                  `ACP agent returned error code ${message.error.code ?? "unknown"}`,
              ),
            );
          } else {
            request.resolve(message.result);
          }
          return;
        }

        if (typeof message.method !== "string") {
          return;
        }

        if (typeof id === "string" || typeof id === "number") {
          let settled = false;
          options.onRequest(message.method, message.params, {
            result(value) {
              if (settled || exited || protocolFailed) return;
              settled = true;
              writeLine({ jsonrpc: "2.0", id, result: value ?? null });
            },
            error(code, errorMessage) {
              if (settled || exited || protocolFailed) return;
              settled = true;
              writeLine({
                jsonrpc: "2.0",
                id,
                error: { code, message: errorMessage },
              });
            },
          });
          return;
        }

        options.onNotification(message.method, message.params);
      },
    });
  }

  if (child.stderr) {
    child.stderr.on("data", appendStderr);
  }

  child.on("error", (error) => {
    if (exited) {
      return;
    }
    exited = true;
    if (closeGraceTimer !== null) clearTimeout(closeGraceTimer);
    if (killEscalation !== null) clearTimeout(killEscalation);
    child.stdout?.destroy();
    child.stderr?.destroy();
    rejectAllPending(
      new AcpAgentExitedError(
        formatAcpLaunchFailure(options.command, error),
      ),
    );
    try {
      options.onExit({ code: null, signal: null, stderrTail: error.message });
    } finally {
      resolveExit();
    }
  });

  child.on("exit", (code, signal) => {
    if (exited) return;
    exitStatus = { code, signal };
    closeGraceTimer = setTimeout(() => finalizeExit(exitStatus!), CLOSE_AFTER_EXIT_GRACE_MS);
    closeGraceTimer.unref?.();
  });
  child.on("close", (code, signal) => {
    finalizeExit(exitStatus ?? { code: code ?? null, signal: signal ?? null });
  });

  return {
    get exited() {
      return exited;
    },

    request({ method, params, resultSchema }) {
      if (exited || protocolFailed) {
        return Promise.reject(
          new AcpAgentExitedError(
            `ACP agent "${options.command}" is not running`,
          ),
        );
      }
      const id = nextRequestId;
      nextRequestId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, {
          resolve: (value) => {
            const parsed = resultSchema.safeParse(value);
            if (parsed.success) {
              resolve(parsed.data);
            } else {
              reject(
                new Error(
                  `ACP agent returned an unexpected ${method} result: ${parsed.error.message}`,
                ),
              );
            }
          },
          reject,
        });
        writeLine({ jsonrpc: "2.0", id, method, params });
      });
    },

    notify(method, params) {
      if (exited || protocolFailed) {
        return;
      }
      writeLine({ jsonrpc: "2.0", method, params });
    },

    kill() {
      if (exited) return exitPromise;
      if (killEscalation === null) {
        killEscalation = setTimeout(() => {
          if (!exited) child.kill("SIGKILL");
        }, KILL_ESCALATION_MS);
        killEscalation.unref?.();
        child.kill("SIGTERM");
      }
      return exitPromise;
    },
  };
}
