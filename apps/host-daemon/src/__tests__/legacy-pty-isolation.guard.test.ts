import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const hostRoot = fileURLToPath(new URL('..', import.meta.url));

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('legacy PTY harness isolation', () => {
  it('does not import AgentRuntime from PTY harness files', () => {
    for (const relative of ['pty.ts', 'harness/registry.ts', 'harness/launch-selection.ts']) {
      const source = stripComments(readFileSync(join(hostRoot, relative), 'utf8'));
      expect(source).not.toContain('@zana-ai/zcc-agent-runtime');
      expect(source).not.toContain('provider-bridge-protocol');
      expect(source).not.toContain('experimental_registerProvider');
    }
  });
});
