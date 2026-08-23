import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const appRoot = fileURLToPath(new URL('..', import.meta.url));

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('thread / legacy isolation', () => {
  it('keeps ThreadCommandComposer off the PTY spawn path', () => {
    const source = stripComments(readFileSync(join(appRoot, 'components/ThreadCommandComposer.tsx'), 'utf8'));
    expect(source).toContain('product.threads.create');
    expect(source).not.toContain('createTerminal');
    expect(source).not.toContain('LaunchProfileId');
    expect(source).not.toContain('product.terminals.create');
  });

  it('keeps the thread view off terminals.create except the optional workspace shell pane', () => {
    const source = stripComments(readFileSync(join(appRoot, 'views/threads/ThreadDetailView.tsx'), 'utf8'));
    expect(source).toContain('ThreadCommandComposer');
    expect(source).not.toContain('createTerminal');
    expect(source).not.toContain('LaunchProfileId');
  });

  it('keeps AgentLauncher off the Thread HTTP create path', () => {
    const source = stripComments(readFileSync(join(appRoot, 'components/AgentLauncher.tsx'), 'utf8'));
    expect(source).not.toContain('threads.create');
    expect(source).not.toContain('product.threads');
  });
});
