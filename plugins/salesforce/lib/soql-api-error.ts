import { compactError } from './dx-project.js';

export interface SoqlApiError {
  message: string;
  errorCode?: string;
  line?: number;
  column?: number;
}

export function parseSoqlApiError(status: number, json: unknown, text: string): SoqlApiError {
  const message = compactError(status, json, text);
  const row = Array.isArray(json) ? json[0] : json;
  let errorCode: string | undefined;
  let line: number | undefined;
  let column: number | undefined;
  if (row && typeof row === 'object') {
    const rec = row as Record<string, unknown>;
    if (typeof rec.errorCode === 'string') errorCode = rec.errorCode;
    if (typeof rec.lineNumber === 'number') line = rec.lineNumber;
    if (typeof rec.columnNumber === 'number') column = rec.columnNumber;
  }
  const match =
    message.match(/row\s+(\d+),\s*column\s+(\d+)/i) ??
    message.match(/line\s+(\d+).*?column\s+(\d+)/i);
  if (match) {
    line ??= Number(match[1]);
    column ??= Number(match[2]);
  }
  return { message, errorCode, line, column };
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  if (name === 'AbortError' || name === 'TimeoutError' || name === 'DOMException') return true;
  const code = (error as { code?: unknown }).code;
  return code === 'ABORT_ERR';
}
