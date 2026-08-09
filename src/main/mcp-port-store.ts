import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readMcpPort(filePath: string): number | undefined {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { port?: unknown };
    return isValidPort(parsed.port) ? parsed.port : undefined;
  } catch {
    return undefined;
  }
}

export function writeMcpPort(filePath: string, port: number): void {
  if (!isValidPort(port)) throw new Error('invalid MCP port');
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify({ port }) + '\n');
  renameSync(tmp, filePath);
}

function isValidPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1_024 && Number(value) <= 65_535;
}
