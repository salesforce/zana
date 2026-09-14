export type ControlErrorCode =
  | 'APP_NOT_RUNNING'
  | 'AMBIGUOUS_SERVER'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'UNHEALTHY'
  | 'INTERACTION'
  | 'ROLE_XOR_MODEL'
  | 'FAKE_ATTACH'
  | 'ISOLATED_CLI_AGENT'
  | 'FORBIDDEN_AGENT'
  | 'NOT_FOUND'
  | 'BAD_USAGE'
  | 'PREFLIGHT';

export class ControlError extends Error {
  readonly code: ControlErrorCode;
  readonly status?: number;
  readonly details?: unknown;

  constructor(code: ControlErrorCode, message: string, opts?: { status?: number; details?: unknown }) {
    super(message);
    this.name = 'ControlError';
    this.code = code;
    this.status = opts?.status;
    this.details = opts?.details;
  }
}

export function exitCodeForControlError(error: ControlError): number {
  switch (error.code) {
    case 'FORBIDDEN_AGENT':
      return 5;
    case 'NOT_FOUND':
      return 3;
    case 'BAD_USAGE':
    case 'ROLE_XOR_MODEL':
    case 'FAKE_ATTACH':
      return 2;
    case 'TIMEOUT':
      return 124;
    default:
      return 1;
  }
}
