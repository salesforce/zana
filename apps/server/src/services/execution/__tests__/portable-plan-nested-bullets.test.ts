import { describe, expect, it } from 'vitest';
import { parsePortablePlan } from '../portable-plan.js';

const wrap = (body: string) => `### a: A <!-- executable-step -->\n${body}\n`;

describe('portable plan nested sub-bullets', () => {
  it('keeps a nested "- Run tests: x" sub-bullet as Work text (bold labels)', () => {
    const parsed = parsePortablePlan(
      wrap(['**Work:**', '  - Run tests: pnpm test', '  - Build: pnpm build', '**Verification:** Read it.'].join('\n'))
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.units[0].task).toContain('Run tests: pnpm test');
      expect(parsed.units[0].task).toContain('Build: pnpm build');
      expect(parsed.units[0].verification).toEqual(['Read it.']);
    }
  });

  it('keeps nested sub-bullets in plain bullet plans without ending Work or Verification', () => {
    const parsed = parsePortablePlan(
      wrap(['- Work: Do it.', '  - Run tests: pnpm test', '- Verification: Check.', '  - Notes: extra', '- Mode: Mutating'].join('\n'))
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.units[0].task).toContain('Run tests: pnpm test');
      expect(parsed.units[0].verification?.[0]).toContain('Notes: extra');
    }
  });

  it('does not reject a nested near-miss "- Works:" sub-bullet', () => {
    const parsed = parsePortablePlan(wrap(['- Work: Do it.', '  - Works: fine'].join('\n')));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.units[0].task).toContain('Works: fine');
  });

  it('still fails on a top-level near-miss label that conflicts with the canonical one', () => {
    const parsed = parsePortablePlan(wrap(['- Work: Do it.', '- Works: fine'].join('\n')));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain('conflicting labels "work" and "works" (both read as "work")');
  });

  it('still treats top-level known plain labels as labels', () => {
    const parsed = parsePortablePlan(wrap(['- Work: Do it.', '- Depends on: `b`', '- Verification: v'].join('\n')));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.units[0].dependencies).toEqual(['b']);
  });
});
