import type { StudioDiagnostic } from '../../../lib/studio-contract.js';

/** The Compile button's last answer for one file version. */
export type CompileState =
  | { status: 'running'; path: string; sha?: string }
  | { status: 'passed'; path: string; sha?: string; summary: string }
  | { status: 'failed'; path: string; sha?: string; code: string; message: string };

const POSITION = /\.agent:(\d{1,6})(?::(\d{1,5}))?|\bline\s+(\d{1,6})(?:\s*[,:]?\s*col(?:umn)?\s+(\d{1,5}))?/i;
const MESSAGE_LIMIT = 2000;

/** A failed compile as one Problems row, at the first position the compiler names (else line 1). */
export function compilerDiagnostic(message: string): StudioDiagnostic {
  const match = message.match(POSITION);
  const line = Math.max(1, Number(match?.[1] ?? match?.[3] ?? 1));
  const column = Math.max(1, Number(match?.[2] ?? match?.[4] ?? 1));
  const text = message.trim() || 'The compiler failed.';
  return {
    line, column, endLine: line, endColumn: column + 1, severity: 'error', code: 'compiler',
    message: text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT - 1)}…` : text
  };
}

/** Reads the agentScript.compile reply; anything unexpected is a failure that says so. */
export function parseCompileReply(path: string, sha: string | undefined, reply: unknown): CompileState {
  const row = reply && typeof reply === 'object' ? reply as { ok?: unknown; summary?: unknown; code?: unknown; error?: unknown } : {};
  const at = { path, ...(sha ? { sha } : {}) };
  if (row.ok === true) return { status: 'passed', ...at, summary: typeof row.summary === 'string' && row.summary ? row.summary : 'Compiled' };
  return {
    status: 'failed', ...at,
    code: typeof row.code === 'string' && row.code ? row.code : 'failed',
    message: typeof row.error === 'string' && row.error ? row.error : 'The compiler did not answer.'
  };
}
