import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('ExecutionJobDetails phase 5 projection', () => {
  const source = readFileSync(new URL('./ExecutionJobDetails.tsx', import.meta.url), 'utf8');

  it('renders attribution completeness, role usage, assembled result, and inactive route fit', () => {
    expect(source).toContain('Attribution: {execution.usage?.completeness');
    expect(source).toContain('execution.usage?.byRole.map');
    expect(source).toContain('<h4>Assembled result</h4>');
    expect(source).toContain('<h4>Route fit</h4>');
    expect(source).toContain('inactive proposal');
    expect(source).toContain('<h4>Final summary</h4>');
    expect(source).not.toContain('unit.structuredResult');
  });

  it('keeps stop available but hides generic retry for resource blocks', () => {
    expect(source).toContain('!execution.resourceBlock');
    expect(source).toContain('Stop Team run');
  });

  it('shows unknown rather than fabricated zero for missing token and cost fields', () => {
    expect(source).toContain("usage.inputTokens ?? 'unknown'");
    expect(source).toContain("usage.outputTokens ?? 'unknown'");
    expect(source).toContain("usage.providerCostUsd === undefined ? 'unknown'");
  });
});
