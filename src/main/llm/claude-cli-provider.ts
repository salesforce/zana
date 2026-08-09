import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { LlmRunResult } from '../../shared/types.js';
import type { LlmProvider, LlmRunRequest } from './provider.js';
import { resolveModelAlias } from '../model-resolve.js';

// Cold `claude --print` calls realistically take ~10–15s, so default generously.
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_CHARS = 2_000;

/**
 * v1 transport: a headless `claude --print` spawn. This reuses the user's
 * existing Claude Code login (no API key to store) and is the literal
 * "sub-agent" the user described — feed a prompt, capture stdout, done.
 *
 * Deliberately NOT node-pty: we want clean, un-decorated stdout, not a TTY with
 * spinner frames and OSC titles. And deliberately run in {@link tmpdir} with no
 * `--mcp-config` / `--settings` so the call can't touch a project, load the
 * zcc-inbox server, or fire hooks — it's a pure one-shot text call.
 *
 * The provider contract is "never throw": every failure path (spawn error,
 * non-zero exit, timeout) resolves to an `ok:false` {@link LlmRunResult} so the
 * service and callers stay branch-free.
 */
export class ClaudeCliProvider implements LlmProvider {
  readonly id = 'claude-cli' as const;

  /**
   * @param binary Path to the `claude` executable (from `AppConfig.claudeBinary`).
   */
  constructor(private readonly binary: string) {}

  run(req: LlmRunRequest): Promise<LlmRunResult> {
    const startedAt = Date.now();
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputChars = req.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    const model = req.model?.trim() || undefined;

    const args = ['--print'];
    if (model) args.push('--model', resolveModelAlias(model));
    // `--system-prompt` REPLACES Claude Code's default agentic system prompt —
    // critical for a sub-agent-style micro-call. `--append-system-prompt` (the
    // wrong choice here) only adds to the full agentic prompt, so the model
    // treats the input as a real task to start (asking questions, using tools)
    // instead of just answering. Verified live: append → "I don't have any code
    // to work with…"; replace → a clean label.
    if (req.system.trim()) args.push('--system-prompt', req.system);
    // `--` end-of-options: everything after is a positional, never a flag. The
    // user text is attacker-influenced (whatever was typed) and a prompt that
    // begins with `-` could otherwise be parsed as a claude flag (argv
    // injection) — e.g. `--mcp-config`, `--add-dir`, `--permission-mode`.
    // Today the tab-namer template happens to prefix non-dash text, but prompt
    // entries are user-editable, so we guard at the spawn boundary regardless.
    args.push('--');
    // The user text is the positional prompt. `--print` reads it and exits.
    args.push(req.user);

    return new Promise<LlmRunResult>((resolve) => {
      const fail = (error: string): void =>
        resolve({
          ok: false,
          text: '',
          error,
          provider: this.id,
          model,
          ms: Date.now() - startedAt
        });

      // Already-cancelled before we spend anything: resolve without spawning.
      if (req.signal?.aborted) {
        fail('aborted');
        return;
      }

      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn(this.binary, args, {
          cwd: tmpdir(),
          env: { ...(process.env as Record<string, string>) },
          // No shell — argv is passed verbatim, so prompt text needs no escaping.
          shell: false
        });
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        return;
      }

      let out = '';
      let err = '';
      let settled = false;

      // Single teardown path — every settle site calls this so we never leak the
      // abort listener or leave the timeout timer armed (Rule 3 spirit).
      const cleanup = (): void => {
        clearTimeout(timer);
        req.signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        fail('aborted');
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        fail(`timed out after ${timeoutMs}ms`);
      }, timeoutMs);

      req.signal?.addEventListener('abort', onAbort);
      // An already-aborted signal never fires 'abort', so fail fast and kill the
      // just-spawned process rather than leaving it live.
      if (req.signal?.aborted) {
        onAbort();
      }

      proc.stdout?.on('data', (chunk: Buffer) => {
        // Bound memory: stop accumulating well past the clamp.
        if (out.length < maxOutputChars * 4) out += chunk.toString('utf8');
      });
      proc.stderr?.on('data', (chunk: Buffer) => {
        if (err.length < 4_000) err += chunk.toString('utf8');
      });

      proc.on('error', (e) => {
        if (settled) return;
        settled = true;
        cleanup();
        fail(e instanceof Error ? e.message : String(e));
      });

      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (code !== 0) {
          fail(err.trim() || `claude exited with code ${code ?? 'null'}`);
          return;
        }
        const text = out.trim().slice(0, maxOutputChars);
        resolve({
          ok: true,
          text,
          provider: this.id,
          model,
          ms: Date.now() - startedAt
        });
      });
    });
  }
}
