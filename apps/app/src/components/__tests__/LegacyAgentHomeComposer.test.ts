import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('LegacyAgentHomeComposer', () => {
  it('spawns through createTerminal and keeps the home mode picker on Legacy Agent', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('createTerminal');
    expect(source).toContain('buildLaunchArgs');
    expect(source).toContain('legacyAgentSelected');
    expect(source).toContain('showLegacyAgent');
    expect(source).toContain('onSelectThread');
    expect(source).toContain('openAgentModal');
    expect(source).toContain('product.harness.effectiveDefault');
    expect(source).toContain('<LauncherModelPicker');
    expect(source).toContain('data-testid="legacy-agent-command-send"');
    expect(source).toContain("from './legacy-agent-home.js'");
    expect(source).not.toContain('product.threads.create');
  });

  it('shows a sending spinner on the launch button while createTerminal is in flight', () => {
    const source = readFileSync(new URL('../LegacyAgentHomeComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Loader2');
    expect(source).toContain('is-sending');
    expect(source).toContain('aria-busy={launching}');
    expect(source).toContain('thread-command-send-spin');
    expect(source).toContain("className={`thread-command-send${launching ? ' is-sending' : ''}`}");
    expect(source).toContain('disabled={launching}');
  });
});
