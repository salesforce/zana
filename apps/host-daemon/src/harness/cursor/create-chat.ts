/**
 * Bounded `cursor-agent create-chat` mint. The TUI `ls` listing cannot be parsed
 * from a non-TUI subprocess, so the only non-interactive way to pin a chat id
 * before spawn is create-chat (prints a UUID). Timeout + stdout cap — never throw.
 */

import { execFile } from 'node:child_process';

const TIMEOUT_MS = 8_000;
const MAX_STDOUT_BYTES = 64 * 1024;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export interface CreateChatDeps {
  runCreateChat?: (binary: string, cwd: string) => Promise<string | null>;
}

function defaultRunCreateChat(binary: string, cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      binary,
      ['create-chat'],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_STDOUT_BYTES },
      (err, stdout) => {
        if (err) return resolve(null);
        resolve(String(stdout ?? ''));
      }
    );
  });
}

export function createCursorChatMinter(deps: CreateChatDeps = {}) {
  const run = deps.runCreateChat ?? defaultRunCreateChat;
  return {
    async mint(binary: string, cwd: string): Promise<string | undefined> {
      try {
        const raw = await run(binary, cwd);
        if (!raw) return undefined;
        const match = raw.match(UUID_RE);
        return match ? match[0] : undefined;
      } catch {
        return undefined;
      }
    }
  };
}

export const cursorChatMinter = createCursorChatMinter();
