import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The launch coordinators (interactive/background/team) moved to the Electron
// main host during the monorepo migration; the commit-revalidation wiring this
// guard pins now lives there rather than in a launch/index.ts barrel.
const source = readFileSync(
  new URL('../../../../../desktop/src/host.ts', import.meta.url),
  'utf8'
);

describe('launch commit revalidation wiring', () => {
  it('rebuilds trusted framework persona before computing current store digest', () => {
    expect(source).toContain('const currentFrameworkPersona = !authorizedPlan.request.personaId');
    expect(source).toContain('resolveFrameworkPersona(');
    expect(source).toContain('personas: currentPersonas');
  });

  it('uses common project/store/task/capacity commit checks for interactive and background launches', () => {
    expect(source.match(/revalidateCommonLaunchCommit\(authorizedPlan/g)).toHaveLength(2);
    // Evidence/consent AND the authorized model pin are re-checked at commit.
    expect(source.match(/return compareCommitExecution\(currentExecution, authorizedPlan\.binding, /g)).toHaveLength(2);
  });

  it('spawns with the main-owned authorized model pin, never a request field', () => {
    expect(source.match(/authorizedModel: finalPlan\.executionAuthorization\.modelPin/g)).toHaveLength(2);
    expect(source).toContain('authorizedModel: opts?.authorizedModel');
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
