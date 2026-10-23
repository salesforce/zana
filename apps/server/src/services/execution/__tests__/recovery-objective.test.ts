import { describe, expect, it } from 'vitest';
import { fitRecoveryObjective } from '../recovery-objective.js';

const HEADER = 'Recovery run: completed read-only work must not be repeated.';
const MARKER = '[Recovery context shortened to fit the 2,048-character goal limit. Full outputs and questions: execution exec-1.]';
const fit = (input: Partial<Parameters<typeof fitRecoveryObjective>[0]>) =>
  fitRecoveryObjective({ header: HEADER, sections: [], sourceExecutionId: 'exec-1', ...input });

describe('fitRecoveryObjective', () => {
  it('returns today\'s plain join unchanged when it fits', () => {
    const sections = ['Verified completed outputs:\nInspect: found A', 'Unresolved human input:\n- Approve?'];
    expect(fit({ objective: 'Ship it', sections })).toBe(['Ship it', HEADER, ...sections].join('\n\n'));
  });

  it('keeps the objective, header and a marker when long sections are cut', () => {
    const out = fit({ objective: 'Ship it', sections: ['a'.repeat(3000), 'second section'] });
    expect(out.length).toBeLessThanOrEqual(2048);
    expect(out.startsWith('Ship it\n\n' + HEADER)).toBe(true);
    expect(out).toContain(MARKER);
    expect(out).not.toContain('second section');
  });

  it('keeps later sections whole when they fit and cuts only the last one that fits partly', () => {
    const out = fit({ objective: 'Ship it', sections: ['short one', 'b'.repeat(3000)] });
    expect(out).toContain('\n\nshort one');
    expect(out.length).toBeLessThanOrEqual(2048);
    expect(out.endsWith(MARKER)).toBe(true);
  });

  it('cuts the objective tail with an ellipsis when it leaves no room', () => {
    const out = fit({ objective: 'o'.repeat(2040), sections: ['section'] });
    expect(out.length).toBeLessThanOrEqual(2048);
    expect(out).toContain('…\n\n' + HEADER);
    expect(out).toContain(MARKER);
    expect(out.startsWith('o')).toBe(true);
  });

  it('handles an undefined objective', () => {
    const out = fit({ sections: ['c'.repeat(3000)] });
    expect(out.length).toBeLessThanOrEqual(2048);
    expect(out.startsWith(HEADER)).toBe(true);
    expect(out).toContain(MARKER);
  });

  it('never splits a surrogate pair', () => {
    // Place a pair so that a naive cut lands between its halves.
    const emoji = '😀';
    const room = 2048 - ('Ship it\n\n' + HEADER).length - ('\n\n' + MARKER).length - 2;
    const out = fit({ objective: 'Ship it', sections: ['x'.repeat(room - 1) + emoji + 'tail'.repeat(100)] });
    expect(out.length).toBeLessThanOrEqual(2048);
    expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(out).not.toMatch(/(?<![\ud800-\udbff])[\udc00-\udfff]/);
    expect(out).not.toContain(emoji);
    expect(out).toContain('x\n\n[Recovery context shortened');
    // And the objective-tail path.
    const objRoom = 2048 - 2 - (HEADER + '\n\n' + MARKER).length - 1;
    const tail = fit({ objective: 'o'.repeat(objRoom - 1) + emoji + 'zzzz'.repeat(100), sections: ['section'] });
    expect(tail.length).toBeLessThanOrEqual(2048);
    expect(tail).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(tail).not.toContain(emoji);
    expect(tail).toContain('o…\n\n' + HEADER);
  });

  it('drops an earlier recovery block so the original goal survives whole', () => {
    const goal = 'Original goal. '.repeat(30).trim();
    const first = fit({ objective: goal, sections: ['d'.repeat(3000)] });
    expect(first.length).toBeLessThanOrEqual(2048);
    expect(first.length).toBeGreaterThan(2000);
    const second = fitRecoveryObjective({
      objective: first, header: HEADER, sections: ['e'.repeat(3000)], sourceExecutionId: 'exec-2'
    });
    expect(second.length).toBeLessThanOrEqual(2048);
    expect(second.startsWith(goal + '\n\n' + HEADER)).toBe(true);
    expect(second.split(HEADER)).toHaveLength(2);
    expect(second.split('[Recovery context shortened')).toHaveLength(2);
    expect(second).toContain('Full outputs and questions: execution exec-2.]');
    expect(second).not.toContain('exec-1');
    expect(second).not.toContain('d'.repeat(50));
  });

  it('keeps the pinned question after a long objective and a long section', () => {
    const question = 'Unresolved human input:\n- Approve target A?';
    for (const objective of [undefined, 'Ship the release', 'g'.repeat(1900), 'g'.repeat(2000)]) {
      const out = fit({ objective, sections: ['r'.repeat(2500)], pinnedSection: question });
      expect(out.length).toBeLessThanOrEqual(2048);
      expect(out).toContain(question);
      expect(out).toContain(HEADER);
      expect(out.endsWith(MARKER)).toBe(true);
      expect(out.indexOf(question)).toBeLessThan(out.indexOf('[Recovery context shortened'));
    }
  });

  const INSTRUCTION = 'Ask this again with execution.work.block before continuing; do not assume an answer.';
  const pinnedOf = (questions: number, width = 20) =>
    `Unresolved human input:\n${Array.from({ length: questions }, (_, i) => `- Q${i}? ${'z'.repeat(width)}`).join('\n')}\n${INSTRUCTION}`;

  it('keeps the instruction whole when a 700-character pinned section is cut', () => {
    const pinned = pinnedOf(14, 30);
    expect(pinned.length).toBeGreaterThan(600);
    const out = fit({ objective: 'g'.repeat(1700), sections: ['r'.repeat(2500)], pinnedSection: pinned });
    expect(out.length).toBeLessThanOrEqual(2048);
    expect(out).toContain(INSTRUCTION);
    expect(out).toContain('- Q0?');
  });

  it('gives a long pinned section more than 512 characters and cuts the list with an ellipsis', () => {
    const pinned = pinnedOf(100, 20);
    expect(pinned.length).toBeGreaterThan(2000);
    const out = fit({ sections: ['r'.repeat(2500)], pinnedSection: pinned });
    expect(out.length).toBeLessThanOrEqual(2048);
    const kept = out.slice(out.indexOf('Unresolved human input'), out.indexOf('\n\n[Recovery context shortened'));
    expect(kept.length).toBeGreaterThan(512);
    expect(kept.length).toBeLessThanOrEqual(1024);
    expect(kept).toContain('…\n' + INSTRUCTION);
  });

  it('keeps the plain join byte for byte when a pinned section fits', () => {
    expect(fit({ objective: 'Ship it', sections: ['out'], pinnedSection: 'ask' })).toBe(['Ship it', HEADER, 'out', 'ask'].join('\n\n'));
  });

  it('recovers a recovery of an objective-less run, dropping the earlier block that starts the objective', () => {
    const first = fit({ sections: ['d'.repeat(3000)], pinnedSection: 'Q1 old question' });
    expect(first.startsWith(HEADER)).toBe(true);
    const second = fitRecoveryObjective({
      objective: first, header: HEADER, sections: ['NEW-OUTPUT ' + 'e'.repeat(3000)], pinnedSection: 'Q2 new question', sourceExecutionId: 'exec-2'
    });
    expect(second.length).toBeLessThanOrEqual(2048);
    expect(second.split(HEADER)).toHaveLength(2);
    expect(second).toContain('NEW-OUTPUT');
    expect(second).toContain('Q2 new question');
    expect(second).not.toContain('Q1 old question');
    expect(second).not.toContain('…');
  });
});

describe('fitRecoveryObjective with long and several open questions', () => {
  const question = [
    'Unresolved human input from the timed-out run:',
    `- ${'Context for the release decision. '.repeat(40)}Approve staging or production? Options: Staging first | Straight to production`,
    '- Which label should result.txt use? Options: About Atlas | Atlas',
    'Ask this again with execution.work.block before continuing; do not assume an answer or contact canceled workers.'
  ].join('\n');

  it('keeps a bounded preview: header, the start of the questions, the re-ask instruction and the source pointer', () => {
    const objective = `${'g'.repeat(2036)}GOAL-TAIL.`;
    const out = fit({ objective, sections: [`Verified completed outputs:\n${'o'.repeat(3000)}`], pinnedSection: question });
    expect(out.length).toBeLessThanOrEqual(2048);
    expect(out).toContain(HEADER);
    expect(out).toContain('Unresolved human input from the timed-out run:\n- Context for the release decision.');
    expect(out).toContain('…\nAsk this again with execution.work.block before continuing');
    expect(out.endsWith(MARKER)).toBe(true);
  });

  it('keeps every question whole when the questions fit in half the limit', () => {
    const short = 'Unresolved human input from the timed-out run:\n- Approve staging or production? Options: Staging first | Straight to production\n- Which label? Options: About Atlas | Atlas\nAsk this again with execution.work.block before continuing.';
    const out = fit({ objective: `${'g'.repeat(2036)}GOAL-TAIL.`, sections: ['o'.repeat(3000)], pinnedSection: short });
    expect(out.length).toBeLessThanOrEqual(2048);
    expect(out).toContain(short);
  });
});
