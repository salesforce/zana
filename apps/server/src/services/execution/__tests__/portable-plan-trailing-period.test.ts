import { describe, expect, it } from 'vitest';
import { parsePortablePlan } from '../portable-plan.js';

// Coordinators (observed: opencode GPT) write label values as sentences, so a
// dependency-free step arrives as `Depends on: None.`. That must mean "no
// dependencies", not a dependency named `None.` (which normalization rejects as
// unknown and strands plan correction on an `invalid` corrected plan).
const step = (id: string, depends: string, write = '`output.md`') => `### ${id}: Title <!-- executable-step -->
- Depends on: ${depends}
- Execution class: low
- Mode: Mutating
- Read scope: Workspace root.
- Write scope: ${write}
- Work: Do it.
- Verification: Read it.
`;

const units = (text: string) => {
  const parsed = parsePortablePlan(text);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.units;
};

describe('portable plan list labels tolerate sentence punctuation', () => {
  it.each(['None.', 'none.', '`None`.', 'None. ', 'None'])('Depends on: %s means no dependencies', (value) => {
    expect(units(step('a', value))[0]?.dependencies).toEqual([]);
  });

  it('strips a trailing period from dependency ids and write scopes', () => {
    const parsed = units(`${step('a', 'None.')}\n${step('b', '`a`.', '`out/x.md`, `out/y.md`.')}`);
    expect(parsed[1]?.dependencies).toEqual(['a']);
    expect(parsed[1]?.files).toEqual(['out/x.md', 'out/y.md']);
  });

  it('keeps interior dots in file names', () => {
    expect(units(step('a', 'None', '`src/a.test.ts`'))[0]?.files).toEqual(['src/a.test.ts']);
  });
});
