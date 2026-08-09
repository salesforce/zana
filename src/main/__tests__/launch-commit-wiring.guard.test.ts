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
});
