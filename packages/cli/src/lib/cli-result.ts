export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr?: string;
}

export function errResult(message: string, exitCode = 1): CliResult {
  return { exitCode, stdout: '', stderr: `Error: ${message}\n` };
}

export function jsonResult(value: unknown): CliResult {
  return { exitCode: 0, stdout: `${JSON.stringify(value, null, 2)}\n` };
}

export function textResult(stdout: string, stderr?: string): CliResult {
  const body = stdout.endsWith('\n') ? stdout : `${stdout}\n`;
  return stderr ? { exitCode: 0, stdout: body, stderr } : { exitCode: 0, stdout: body };
}

export function deprecation(message: string, result: CliResult): CliResult {
  const note = `Warning: ${message}\n`;
  return { ...result, stderr: `${note}${result.stderr ?? ''}` };
}
