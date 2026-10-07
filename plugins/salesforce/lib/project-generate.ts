import { join } from 'node:path';

export type GenerateInput =
  | { ok: true; name: string; outputDir: string }
  | { ok: false; code: 'invalid_input'; error: string };

export function parseGenerateInput(args: unknown): GenerateInput {
  if (!args || typeof args !== 'object') {
    return { ok: false, code: 'invalid_input', error: 'generate requires name and outputDir.' };
  }
  const row = args as Record<string, unknown>;
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const outputDir = typeof row.outputDir === 'string' ? row.outputDir.trim() : '';
  if (!name) return { ok: false, code: 'invalid_input', error: 'Project name is required.' };
  if (name.includes('\0') || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    return { ok: false, code: 'invalid_input', error: 'Project name cannot contain path separators.' };
  }
  if (!outputDir || outputDir.includes('\0')) {
    return { ok: false, code: 'invalid_input', error: 'Parent folder is required.' };
  }
  return { ok: true, name, outputDir };
}

export function generatedProjectPath(outputDir: string, name: string): string {
  // sf project generate reports the parent in result.outputDir. The generated
  // DX root is always the requested child, regardless of the CLI response shape.
  return join(outputDir, name);
}
