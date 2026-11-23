import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Squad editor slot tooltips', () => {
  it('anchor to the control start so they stay inside the narrow drawer', () => {
    const css = readFileSync(join(__dirname, '../styles/global.css'), 'utf8');
    const rule = css.match(/\.team-slot-reorder \.composer-control-tooltip::after,\s*\.team-slot-orch-toggle\.composer-control-tooltip::after\s*\{([^}]*)\}/);
    expect(rule, 'slot tooltip anchor rule').toBeTruthy();
    expect(rule![1]).toMatch(/left:\s*0/);
    expect(rule![1]).toMatch(/right:\s*auto/);
  });
});
