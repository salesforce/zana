import { z } from "zod";
import { rpcContract } from "./contracts.js";

export const commands = [
  {
    name: "open",
    summary:
      "Open an isolated desktop or local headless session; --tab explicitly hands off an existing tab",
    usage:
      "zcc browser-automation open --backend desktop --machine <id-or-name> --desktop <instance-id> [--tab <tab-id>] [--thread <id>] [--json] | open --backend local --headless --machine <id-or-name> [--thread <id>] [--json]",
  },
  {
    name: "list",
    summary: "List this thread's browser sessions",
    usage: "zcc browser-automation list [--thread <id>] [--json]",
  },
  {
    name: "run",
    summary: "Run a trusted DevBrowser script; runs serialize per session",
    usage:
      "zcc browser-automation run <session-id> (--script <code> | --script-file <path> --script-host <host-id>) [--timeout <duration> | --timeout-ms <1000..120000>] [--thread <id>] [--json]",
  },
  {
    name: "pages",
    summary: "Inspect persistent named pages",
    usage: "zcc browser-automation pages <session-id> [--thread <id>] [--json]",
  },
  {
    name: "screenshot",
    summary: "Save a bounded JPEG in session tmp; return its path and host ID",
    usage:
      "zcc browser-automation screenshot <session-id> [--page <name>] [--thread <id>] [--json]",
  },
  {
    name: "preview",
    summary:
      "Describe the live preview frame of a local headless session, without image bytes",
    usage:
      "zcc browser-automation preview <session-id> [--after <sequence>] [--thread <id>] [--json]",
  },
  {
    name: "stop",
    summary:
      "Cancel queued and running work and release control; open a new session to resume",
    usage: "zcc browser-automation stop <session-id> [--thread <id>] [--json]",
  },
  {
    name: "close",
    summary: "Dispose owned browsers and tabs, preserving handed-off tabs",
    usage: "zcc browser-automation close <session-id> [--thread <id>] [--json]",
  },
];
const methodSchema = z.enum([
  "open",
  "list",
  "run",
  "pages",
  "screenshot",
  "preview",
  "stop",
  "close",
]);

export function cliHelp(argv: string[]): string | undefined {
  if (argv.length && !argv.includes("--help") && !argv.includes("-h"))
    return undefined;
  const args = argv.filter(arg => arg !== "--help" && arg !== "-h" && arg !== "--json");
  if (args.length > 1) throw new Error("Help accepts only a command name");
  const selected = args[0] ? commands.filter(command => command.name === args[0]) : commands;
  if (!selected.length) throw new Error(`Unknown command: ${args[0]}`);
  return [
    "Browser Automation — persistent desktop and headless sessions",
    ...selected.map(command => `${command.summary}\n${command.usage}`),
    "Sessions expire after five minutes idle or thirty minutes total. A stopped session requires a new open.",
    ...(args[0] === "run" || !args.length ? [
      "Timeout defaults to 30s, range 1–120s. --timeout accepts 90s, 2m, 1500ms; bare values are seconds (1–120) or milliseconds (1000–120000).",
      "Runs return at most 4 JPEG screenshots, 500 KB combined.",
    ] : []),
  ].join("\n\n");
}

function timeoutDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(value);
  if (!match) throw new Error("Invalid --timeout; use 90s, 2m, or 1500ms");
  const amount = Number(match[1]);
  const unit = match[2] ?? (amount <= 120 ? "s" : "ms");
  const milliseconds = amount * (unit === "m" ? 60_000 : unit === "s" ? 1000 : 1);
  if (!Number.isInteger(milliseconds) || milliseconds < 1000 || milliseconds > 120_000)
    throw new Error("Timeout must be between 1000 and 120000 milliseconds (1–120 seconds)");
  return milliseconds;
}

export function cliFailure(error: unknown, json: boolean) {
  const message = error instanceof Error ? error.message : "Browser command failed";
  const detail = /stopped or expired|does not belong to this thread/u.test(message)
    ? { code: "session_unavailable", message, hint: "Open a new browser session and take a fresh snapshot." }
    : /screenshot|JPEG/iu.test(message)
      ? { code: "screenshot_limit", message, hint: "Return at most 4 JPEG screenshots per run, 500 KB combined." }
      : { code: "command_failed", message };
  return {
    exitCode: 1,
    stderr: message,
    ...(json ? { stdout: JSON.stringify({ ok: false, error: detail }) } : {}),
  };
}

export function parseCli(argv: string[], contextThreadId?: string) {
  const method = methodSchema.parse(argv[0]);
  const flags = new Map<string, string>();
  const positionals: string[] = [];
  const allowed = new Set([
    "--json",
    "--thread",
    ...(method === "open"
      ? ["--backend", "--machine", "--desktop", "--tab", "--headless"]
      : method === "run"
        ? ["--script", "--script-file", "--script-host", "--timeout-ms", "--timeout"]
        : method === "screenshot"
          ? ["--page"]
          : method === "preview"
            ? ["--after"]
            : []),
  ]);
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    if (!allowed.has(arg) || flags.has(arg))
      throw new Error(`Unknown or duplicate flag: ${arg}`);
    if (arg === "--json" || arg === "--headless") flags.set(arg, "true");
    else {
      const value = argv[++index];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${arg}`);
      flags.set(arg, value);
    }
  }
  const threadId = flags.get("--thread") ?? contextThreadId;
  if (!threadId) throw new Error("Run from a Zana thread or pass --thread <id>");
  if (contextThreadId && threadId !== contextThreadId)
    throw new Error(
      "CLI calls from a thread cannot access another thread's browser session",
    );
  const input: {
    threadId: string;
    sessionId?: string;
    selection?: z.input<typeof rpcContract.open.input>["selection"];
    script?: string;
    timeoutMs?: number;
    page?: string;
    afterSequence?: number;
  } = { threadId };
  if (method === "open" || method === "list") {
    if (positionals.length) throw new Error("Unexpected positional argument");
  } else {
    if (positionals.length !== 1) throw new Error("Expected one session ID");
    input.sessionId = positionals[0];
  }
  if (method === "open") {
    const hostId = flags.get("--machine");
    if (!hostId)
      throw new Error("Select the browser host with --machine <id-or-name>");
    const backend = flags.get("--backend");
    if (backend === "local") {
      if (
        !flags.has("--headless") ||
        flags.has("--desktop") ||
        flags.has("--tab")
      )
        throw new Error(
          "Local sessions require --headless and cannot select desktop tabs",
        );
      input.selection = { backend, hostId };
    } else if (backend === "desktop") {
      const instanceId = flags.get("--desktop");
      if (!instanceId || flags.has("--headless"))
        throw new Error(
          "Desktop sessions require --desktop <instance-id> and cannot use --headless",
        );
      input.selection = {
        backend,
        hostId,
        instanceId,
        ...(flags.has("--tab") ? { tabId: flags.get("--tab") } : {}),
      };
    } else throw new Error("Select --backend desktop or --backend local");
  }
  if (method === "run") {
    if (flags.has("--script") === flags.has("--script-file"))
      throw new Error("Supply exactly one of --script or --script-file");
    if (flags.has("--script-file") !== flags.has("--script-host"))
      throw new Error(
        "--script-file requires explicit --script-host <host-id>",
      );
    input.script = flags.get("--script");
    if (flags.has("--timeout") && flags.has("--timeout-ms"))
      throw new Error("Supply only one of --timeout or --timeout-ms");
    input.timeoutMs = flags.has("--timeout")
      ? timeoutDuration(flags.get("--timeout")!)
      : flags.has("--timeout-ms")
        ? Number(flags.get("--timeout-ms"))
        : 30_000;
  }
  if (method === "screenshot") input.page = flags.get("--page") ?? "main";
  if (method === "preview")
    input.afterSequence = flags.has("--after")
      ? Number(flags.get("--after"))
      : 0;
  return {
    method,
    input,
    scriptFile: flags.get("--script-file"),
    scriptHost: flags.get("--script-host"),
  };
}
