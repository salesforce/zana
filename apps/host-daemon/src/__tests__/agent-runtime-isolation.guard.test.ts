import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('thread AgentRuntime isolation', () => {
  it('does not import PtyManager, LaunchProvider, or the PTY harness registry', () => {
    const source = stripComments(readFileSync(join(root, 'agent-runtime-adapter.ts'), 'utf8'));
    expect(source).not.toMatch(/from ['"]\.\/pty\.js['"]/);
    expect(source).not.toMatch(/from ['"]\.\/harness\/registry\.js['"]/);
    expect(source).not.toContain('HARNESS_REGISTRATIONS');
    expect(source).not.toContain('LaunchProvider');
    expect(source).not.toContain('LaunchProfileId');
    expect(source).not.toMatch(/from ['"]\.\/thread-runtime\.js['"]/);
    expect(source).toContain('@zana-ai/zcc-agent-runtime');
  });

  it('keeps RuntimeManager on the AgentRuntime path', () => {
    const source = stripComments(readFileSync(join(root, 'runtime-manager.ts'), 'utf8'));
    expect(source).not.toMatch(/from ['"]\.\/pty\.js['"]/);
    expect(source).not.toMatch(/from ['"]\.\/harness\/registry\.js['"]/);
    expect(source).not.toContain('HARNESS_REGISTRATIONS');
    expect(source).not.toContain('LaunchProvider');
    expect(source).not.toContain('LaunchProfileId');
    expect(source).toContain('./agent-runtime-adapter.js');
  });
});
