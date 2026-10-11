import type {
  PluginCliCommandInfo,
  PluginCliResult,
  ZccPluginApi,
} from "@zana-ai/zcc-plugin-sdk/server";
import { policySchema, type Policy } from "./contract.js";
import type { Service } from "./service.js";
import type { Storage } from "./storage.js";

type FlagKind = "string" | "boolean";
interface CommandSpec {
  summary: string;
  usage: string;
  flags: Readonly<Record<string, FlagKind>>;
  run(flags: Flags): Promise<unknown>;
}
type Flags = ReadonlyMap<string, string | true>;

/** A mistake in how the command was typed, as opposed to a failure while running it. */
class UsageError extends Error {}

const text = (flags: Flags, name: string): string | undefined => {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
};
const flag = (flags: Flags, name: string) => flags.get(name) === true;
function required(flags: Flags, name: string): string {
  const value = text(flags, name);
  if (!value) throw new Error(`Provide --${name}.`);
  return value;
}
function confirmed(flags: Flags, what: string) {
  if (!flag(flags, "yes")) throw new Error(`Pass --yes to ${what}.`);
}
function days(value: string | undefined, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  if (value === "never") return null;
  if (!/^\d+$/.test(value)) throw new Error("Use a number of days (1-3650) or never.");
  return Number(value);
}
function booleanSetting(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  if (value !== "true" && value !== "false") throw new Error(`Use true or false for --${name}.`);
  return value === "true";
}

/** `--name value`, `--name=value` and bare boolean switches; anything else is a usage error. */
function parseFlags(argv: readonly string[], spec: CommandSpec["flags"]): Flags {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (!token.startsWith("--")) throw new UsageError(`Unexpected argument ${token}`);
    const equals = token.indexOf("=");
    const name = token.slice(2, equals === -1 ? undefined : equals);
    const kind = Object.hasOwn(spec, name) ? spec[name] : undefined;
    if (kind === undefined) throw new UsageError(`Unknown option --${name}`);
    if (flags.has(name)) throw new UsageError(`Option --${name} was given twice`);
    if (kind === "boolean") {
      if (equals !== -1) throw new UsageError(`Option --${name} takes no value`);
      flags.set(name, true);
      continue;
    }
    const value = equals === -1 ? argv[++index] : token.slice(equals + 1);
    if (value === undefined || value === "" || (equals === -1 && value.startsWith("--")))
      throw new UsageError(`Option --${name} needs a value`);
    flags.set(name, value);
  }
  return flags;
}

export function registerCli(zcc: ZccPluginApi, service: Service, storage: Storage) {
  const commands: Record<string, CommandSpec> = {
    usage: {
      summary: "Read cached machine usage; --rescan starts a background scan, rerun to see results",
      usage: "zcc storage usage [--machine <id>] [--rescan]",
      flags: { machine: "string", rescan: "boolean" },
      async run(flags) {
        const hostId = text(flags, "machine");
        if (flag(flags, "rescan")) return hostId ? storage.scanHost({ hostId }) : storage.scanAll();
        return hostId ? storage.host({ hostId }) : storage.hosts();
      },
    },
    retention: {
      summary: "Show the policy and last run, preview thresholds, or save them with --save --yes",
      usage:
        "zcc storage retention [--archive-after <days|never>] [--clear-after <days|never>] [--clear-on-archive <true|false>] [--save --yes]",
      flags: {
        "archive-after": "string",
        "clear-after": "string",
        "clear-on-archive": "string",
        save: "boolean",
        yes: "boolean",
      },
      async run(flags) {
        const state = await service.state();
        const archiveAfter = text(flags, "archive-after");
        const clearAfter = text(flags, "clear-after");
        const clearOnArchive = text(flags, "clear-on-archive");
        const parsed = policySchema.safeParse({
          archiveAfterDays: days(archiveAfter, state.policy.archiveAfterDays),
          clearAfterDays: days(clearAfter, state.policy.clearAfterDays),
          clearStorageOnArchive: booleanSetting(
            clearOnArchive,
            state.policy.clearStorageOnArchive,
            "clear-on-archive",
          ),
        });
        if (!parsed.success) throw new Error("Days must be a whole number from 1 to 3650, or never.");
        const policy: Policy = parsed.data;
        if (flag(flags, "save")) {
          if (!flag(flags, "yes"))
            throw new Error("Preview first, then pass --save --yes to confirm the policy.");
          return service.configure(policy);
        }
        if (archiveAfter !== undefined || clearAfter !== undefined || clearOnArchive !== undefined)
          return { policy, preview: await service.preview(policy) };
        return state;
      },
    },
    "remove-orphans": {
      summary: "Remove orphaned thread storage found by the last scan of --machine",
      usage: "zcc storage remove-orphans --machine <id> --yes [--background]",
      flags: { machine: "string", yes: "boolean", background: "boolean" },
      async run(flags) {
        confirmed(flags, "permanently remove orphaned storage");
        const hostId = required(flags, "machine");
        if (!flag(flags, "background")) return storage.removeOrphans({ hostId });
        await storage.startRemoveOrphans({ hostId });
        return { started: true };
      },
    },
    "clear-large-files": {
      summary:
        "Delete files of 10 MB or more from archived threads on --machine, or on every scanned machine",
      usage: "zcc storage clear-large-files [--machine <id>] --yes [--background]",
      flags: { machine: "string", yes: "boolean", background: "boolean" },
      async run(flags) {
        confirmed(flags, "permanently delete large files from archived threads");
        const hostId = text(flags, "machine") ?? null;
        if (!flag(flags, "background")) return storage.clearLargeFiles({ hostId });
        await storage.startClearLargeFiles({ hostId });
        return { started: true };
      },
    },
    "clear-archived-files": {
      summary: "Clear all stored files of archived, stopped, unpinned threads on --machine",
      usage: "zcc storage clear-archived-files --machine <id> --yes [--background]",
      flags: { machine: "string", yes: "boolean", background: "boolean" },
      async run(flags) {
        confirmed(flags, "permanently clear archived thread files");
        const hostId = required(flags, "machine");
        if (!flag(flags, "background")) return storage.clearArchivedFiles({ hostId });
        await storage.startClearArchivedFiles({ hostId });
        return { started: true };
      },
    },
    "clear-thread": {
      summary: "Empty one stopped thread's storage directory; the thread stays",
      usage: "zcc storage clear-thread --thread <id> --yes",
      flags: { thread: "string", yes: "boolean" },
      async run(flags) {
        confirmed(flags, "permanently clear thread storage");
        return storage.clearThread({ threadId: required(flags, "thread") });
      },
    },
  };

  const info: PluginCliCommandInfo[] = Object.entries(commands).map(([name, spec]) => ({
    name,
    summary: spec.summary,
    usage: spec.usage,
  }));
  const help = () =>
    [
      "Usage: zcc storage <command> [options]",
      "",
      ...info.map((command) => `  ${command.usage}\n      ${command.summary}`),
      "",
      "Destructive commands need --yes. Every command prints JSON.",
      "Add --background to a cleanup to start it and return; read progress with `zcc storage usage`.",
      "",
    ].join("\n");

  zcc.cli.register({
    name: "storage",
    summary: "Inspect storage and manage thread retention (JSON output)",
    commands: info,
    async run(argv): Promise<PluginCliResult> {
      const [name, ...rest] = argv;
      if (name === undefined || name === "help" || name === "--help")
        return { exitCode: 0, stdout: help() };
      const spec = Object.hasOwn(commands, name) ? commands[name] : undefined;
      if (!spec) return { exitCode: 2, stderr: `Unknown command ${name}\n${help()}` };
      try {
        if (rest.includes("--help")) return { exitCode: 0, stdout: `${spec.usage}\n${spec.summary}\n` };
        const flags = parseFlags(rest, spec.flags);
        return { exitCode: 0, stdout: `${JSON.stringify(await spec.run(flags), null, 2)}\n` };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return error instanceof UsageError
          ? { exitCode: 2, stderr: `${message}\nUsage: ${spec.usage}\n` }
          : { exitCode: 1, stderr: `${message}\n` };
      }
    },
  });
}
