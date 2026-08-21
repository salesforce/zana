import { describe, it, expect } from 'vitest';
import {
  buildInterviewPrompt,
  parseArgumentNames,
  hasArguments,
  resolveArguments,
  substituteArguments,
  type WorkflowArgument
} from './workflow-args.js';

describe('parseArgumentNames', () => {
  it('extracts ordered, de-duplicated names', () => {
    expect(parseArgumentNames('deploy {{env}} {{service}} to {{env}}')).toEqual([
      'env',
      'service'
    ]);
  });

  it('trims whitespace inside a slot', () => {
    expect(parseArgumentNames('run {{  package  }} tests')).toEqual(['package']);
  });

  it('ignores triple-brace escapes', () => {
    expect(parseArgumentNames('teach {{{var}}} but fill {{real}}')).toEqual(['real']);
  });

  it('ignores malformed / empty slots', () => {
    expect(parseArgumentNames('a {{}} b {{ two words }} c {{ok}}')).toEqual(['ok']);
  });

  it('returns empty for a plain flat prompt', () => {
    expect(parseArgumentNames('just a normal prompt')).toEqual([]);
  });

  it('accepts word-ish chars: letters, digits, _ . -', () => {
    expect(parseArgumentNames('{{a_b.c-1}}')).toEqual(['a_b.c-1']);
  });
});

describe('hasArguments', () => {
  it('is true only when a real slot exists', () => {
    expect(hasArguments('run {{x}}')).toBe(true);
    expect(hasArguments('run x')).toBe(false);
    expect(hasArguments('literal {{{x}}}')).toBe(false);
  });
});

describe('resolveArguments', () => {
  it('uses the template as source of truth for which args exist', () => {
    const declared: WorkflowArgument[] = [
      { name: 'env', type: 'enum', enumValues: ['dev', 'prod'], description: 'target' },
      { name: 'unused', type: 'text' } // no matching slot → dropped
    ];
    const out = resolveArguments('deploy {{env}} {{service}}', declared);
    expect(out.map((a) => a.name)).toEqual(['env', 'service']);
    expect(out[0]).toMatchObject({ type: 'enum', enumValues: ['dev', 'prod'] });
    expect(out[1]).toEqual({ name: 'service' }); // undeclared slot → bare text
  });

  it('handles absent declarations', () => {
    expect(resolveArguments('hi {{name}}', undefined)).toEqual([{ name: 'name' }]);
  });
});

describe('substituteArguments', () => {
  it('fills provided values', () => {
    expect(substituteArguments('deploy {{env}}', { env: 'prod' })).toBe('deploy prod');
  });

  it('falls back to defaultValue when blank or missing', () => {
    const declared: WorkflowArgument[] = [{ name: 'pkg', defaultValue: 'core' }];
    expect(substituteArguments('test {{pkg}}', {}, declared)).toBe('test core');
    expect(substituteArguments('test {{pkg}}', { pkg: '' }, declared)).toBe('test core');
    expect(substituteArguments('test {{pkg}}', { pkg: 'ui' }, declared)).toBe('test ui');
  });

  it('empties an unfilled slot with no default (never leaks the placeholder)', () => {
    expect(substituteArguments('x {{y}} z', {})).toBe('x  z');
  });

  it('resolves triple-brace escapes to literal double braces', () => {
    expect(substituteArguments('use {{{var}}} syntax', {})).toBe('use {{var}} syntax');
  });

  it('leaves a malformed slot verbatim', () => {
    expect(substituteArguments('a {{ two words }} b', {})).toBe('a {{ two words }} b');
  });

  it('substitutes every occurrence of a repeated slot', () => {
    expect(substituteArguments('{{n}}+{{n}}', { n: '2' })).toBe('2+2');
  });

  it('round-trips escape + real slot together', () => {
    expect(
      substituteArguments('literal {{{skip}}} filled {{real}}', { real: 'X' })
    ).toBe('literal {{skip}} filled X');
  });
});

describe('buildInterviewPrompt', () => {
  it('returns the template unchanged when it has no real slots', () => {
    expect(buildInterviewPrompt('just do the thing')).toBe('just do the thing');
    // A triple-brace escape is not a slot, so still no interview.
    expect(buildInterviewPrompt('use {{{var}}} syntax')).toBe('use {{{var}}} syntax');
  });

  it('embeds the original template (slots intact) plus an ask instruction', () => {
    const out = buildInterviewPrompt('deploy {{env}}');
    expect(out).toContain('deploy {{env}}'); // template kept verbatim, not substituted
    expect(out.toLowerCase()).toContain('ask me');
    expect(out).toContain('`env`');
  });

  it('lists enum choices and defaults for each argument in template order', () => {
    const declared: WorkflowArgument[] = [
      { name: 'depth', type: 'enum', enumValues: ['quick', 'thorough'], defaultValue: 'thorough' },
      { name: 'branch', type: 'text', description: 'Branch to review', defaultValue: 'HEAD' }
    ];
    const out = buildInterviewPrompt('review {{branch}} with a {{depth}} pass', declared);
    expect(out).toContain('choose one of: quick, thorough');
    expect(out).toContain('(default: thorough)');
    expect(out).toContain('(default: HEAD)');
    expect(out).toContain('Branch to review');
    // Argument bullets follow template (first-seen) order: branch before depth.
    expect(out.indexOf('`branch`')).toBeLessThan(out.indexOf('`depth`'));
  });

  it('drops a declared arg with no matching slot (template is source of truth)', () => {
    const declared: WorkflowArgument[] = [
      { name: 'used', type: 'text' },
      { name: 'ghost', type: 'enum', enumValues: ['a', 'b'] }
    ];
    const out = buildInterviewPrompt('only {{used}} here', declared);
    expect(out).toContain('`used`');
    expect(out).not.toContain('`ghost`');
  });
});
