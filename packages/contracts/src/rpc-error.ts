/**
 * Expected-domain-error contract for plugin RPC. A handler that rejects with a
 * recognised domain error (validation guard, conflict, not found...) is part of
 * normal operation: it travels to the caller as a structured rejection and is
 * never logged as a main-process failure. Everything else is unexpected and
 * keeps the throw-and-log behaviour. Core never names a specific plugin here.
 */

export const EXPECTED_RPC_ERROR_CODES = ['invalid', 'conflict', 'not_found', 'limit', 'forbidden'] as const;
export type ExpectedRpcErrorCode = (typeof EXPECTED_RPC_ERROR_CODES)[number];

const EXPECTED_CODE_SET: ReadonlySet<string> = new Set(EXPECTED_RPC_ERROR_CODES);
const MAX_RPC_ERROR_MESSAGE = 8192;
const MAX_RPC_ERROR_CODE = 64;

export interface ExpectedRpcError {
  message: string;
  /** One of EXPECTED_RPC_ERROR_CODES; derived from `status` for bare 4xx errors. */
  code: string;
  /** HTTP status to answer with. */
  status: number;
}

const STATUS_BY_CODE: Record<ExpectedRpcErrorCode, number> = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  limit: 413
};

/** Classify a thrown value. Returns null for unexpected errors. */
export function classifyExpectedRpcError(error: unknown): ExpectedRpcError | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, status, message } = error as { code?: unknown; status?: unknown; message?: unknown };
  const text = (typeof message === 'string' && message.length > 0 ? message : 'request failed').slice(0, MAX_RPC_ERROR_MESSAGE);
  if (typeof code === 'string' && EXPECTED_CODE_SET.has(code)) {
    return { message: text, code, status: STATUS_BY_CODE[code as ExpectedRpcErrorCode] };
  }
  if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 499) {
    // Normalise to the generic set so expected-ness survives hops that only forward `code`.
    return { message: text, code: codeForStatus(status), status };
  }
  return null;
}

function codeForStatus(status: number): ExpectedRpcErrorCode {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 413 || status === 429) return 'limit';
  return 'invalid';
}

/** Error carrying an optional machine-readable `code` (renderer-facing shape). */
export function rpcErrorFrom(message: string, code?: unknown, status?: unknown): Error & { code?: string; status?: number } {
  const err = new Error(message) as Error & { code?: string; status?: number };
  if (typeof code === 'string' && code.length > 0 && code.length <= MAX_RPC_ERROR_CODE) err.code = code;
  if (typeof status === 'number' && Number.isInteger(status)) err.status = status;
  return err;
}

/** IPC envelope an expected rejection travels in (resolved, so ipcMain does not log). */
export interface RpcErrorEnvelope {
  __zccRpcError: { message: string; code: string };
}

export function toRpcErrorEnvelope(error: ExpectedRpcError): RpcErrorEnvelope {
  return { __zccRpcError: { message: error.message, code: error.code } };
}

/** Strictly parse an envelope; returns null when `value` is not one. */
export function parseRpcErrorEnvelope(value: unknown): { message: string; code?: string } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const inner = (value as { __zccRpcError?: unknown }).__zccRpcError;
  if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return null;
  const { message, code } = inner as { message?: unknown; code?: unknown };
  if (typeof message !== 'string') return null;
  if (code !== undefined && typeof code !== 'string') return null;
  return {
    message: message.slice(0, MAX_RPC_ERROR_MESSAGE),
    ...(typeof code === 'string' && code.length > 0 && code.length <= MAX_RPC_ERROR_CODE ? { code } : {})
  };
}
