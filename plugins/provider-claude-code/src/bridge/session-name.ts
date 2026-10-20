import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Claude Code does not restore a session's `/rename` name when the session is
 * resumed: the new process registers under a name derived from the cwd (for
 * example `my-project-04`), so peers addressing the renamed session lose it.
 * The name survives in the transcript as `agent-name` / `custom-title`
 * records, which Claude re-appends as the session runs, so the bridge reads
 * the latest one from the transcript tail and passes it back as `--name`.
 */

const TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;

export interface SessionNameFs {
  isFile(file: string): boolean;
  readdir(dir: string): string[];
  readTail(file: string, bytes: number): string;
}

export const NODE_SESSION_NAME_FS: SessionNameFs = {
  isFile: (file) => {
    try { return statSync(file).isFile(); } catch { return false; }
  },
  readdir: (dir) => {
    try { return readdirSync(dir); } catch { return []; }
  },
  readTail: (file, bytes) => {
    const fd = openSync(file, "r");
    try {
      const size = statSync(file).size;
      const length = Math.min(size, bytes);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      return buffer.toString("utf8");
    } finally {
      closeSync(fd);
    }
  },
};

export function readResumeSessionName(args: {
  sessionId: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  fs?: SessionNameFs;
}): string | undefined {
  const fs = args.fs ?? NODE_SESSION_NAME_FS;
  const transcript = findTranscript(args.sessionId, args.cwd, args.env, fs);
  if (!transcript) return undefined;
  try {
    return latestSessionName(fs.readTail(transcript, TRANSCRIPT_TAIL_BYTES));
  } catch {
    return undefined;
  }
}

function findTranscript(
  sessionId: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  fs: SessionNameFs,
): string | undefined {
  const projects = path.join(
    env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
    "projects",
  );
  const file = `${sessionId}.jsonl`;
  // Claude names a project folder after its cwd with every non-alphanumeric
  // replaced by `-`; long paths are shortened, so fall back to a scan.
  const direct = path.join(projects, cwd.replace(/[^A-Za-z0-9]/g, "-"), file);
  if (fs.isFile(direct)) return direct;
  return fs
    .readdir(projects)
    .map((dir) => path.join(projects, dir, file))
    .find((candidate) => fs.isFile(candidate));
}

/**
 * The newest `agent-name` or `custom-title` value. Claude writes the pair
 * together on `/rename`; a fork appends only a `custom-title` ("… (fork)")
 * after the copied history, so the newest record also keeps a fork from
 * claiming its source session's name.
 */
export function latestSessionName(text: string): string | undefined {
  let name: string | undefined;
  for (const line of text.split("\n")) {
    if (!line.includes('"agent-name"') && !line.includes('"custom-title"')) {
      continue;
    }
    let record: { type?: unknown; agentName?: unknown; customTitle?: unknown };
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const value =
      record.type === "agent-name"
        ? record.agentName
        : record.type === "custom-title"
          ? record.customTitle
          : undefined;
    if (typeof value === "string" && value.trim()) name = value.trim();
  }
  return name;
}
