import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

describe('launch commit revalidation wiring', () => {
  it('rebuilds trusted framework persona before computing current store digest', () => {
    expect(source).toContain('const currentFrameworkPersona = !authorizedPlan.request.personaId');
    expect(source).toContain('resolveFrameworkPersona(');
    expect(source).toContain('personas: currentPersonas');
  });

  it('uses common project/store/task/capacity commit checks for interactive and background launches', () => {
    expect(source.match(/revalidateCommonLaunchCommit\(authorizedPlan/g)).toHaveLength(2);
    expect(source).toContain('evidenceDigest: currentExecution.evidenceDigest');
  });

  it('passes one main-owned effective launch cwd to initial/commit preflight and spawn', () => {
    const calls = [...source.matchAll(/preflightTerminalExecution\(\{([\s\S]*?)\}, \{/g)]
      .map((match) => match[1]);
    expect(calls).toHaveLength(4);
    expect(calls[0]).toContain('projectPath: effectiveLaunch.cwd');
    expect(calls[1]).toContain('projectPath: authorizedPlan.resolved.effectiveLaunch.cwd');
    expect(calls[2]).toContain('projectPath: effectiveLaunch.cwd');
    expect(calls[3]).toContain('projectPath: authorizedPlan.resolved.effectiveLaunch.cwd');
    expect(source).toContain('effectiveLaunch: authorizedPlan.resolved.effectiveLaunch');
    expect(source).toContain('const spawnLaunch = materializeEffectiveLaunch(authorizedPlan.resolved.effectiveLaunch)');
    expect(source).toContain('cwd: spawnLaunch.cwd');
    expect(source.match(/revalidateEffectiveLaunch\(authorizedPlan\.resolved\.effectiveLaunch, currentProject\)/g))
      .toHaveLength(2);
  });
});
