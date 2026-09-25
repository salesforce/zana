// @vitest-environment jsdom
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { scopeTaskStyles } from './scope-styles.mjs';

function scoped(source: string) {
  const css = postcss.parse(source);
  scopeTaskStyles(css);
  return css;
}

describe('Tasks stylesheet confinement', () => {
  it('styles panel roots, portal roots and their descendants without touching host UI', () => {
    const css = scoped('.fixed { position: fixed }');
    const selector = (css.first as postcss.Rule).selector;
    const fixture = document.createElement('div');
    fixture.innerHTML = `<div class="bb-tasks fixed"><div class="fixed"></div></div>
      <div data-bb-plugin="tasks" class="fixed"><div class="fixed"></div></div>
      <div class="fixed"></div><div data-bb-plugin="other" class="fixed"></div>`;
    expect([...fixture.querySelectorAll('.fixed')].map(node => node.matches(selector)))
      .toEqual([true, true, true, true, false, false]);
  });

  it('scopes theme variables to panel and portal roots', () => {
    expect(scoped(':root, :host { --spacing: 4px }').toString())
      .toBe('.bb-tasks, [data-bb-plugin="tasks"] { --spacing: 4px }');
  });

  it('preserves pre-scoped rules, nested selectors and keyframes', () => {
    const source = `.bb-tasks .editor { color: red }
      [data-bb-plugin="tasks"] { color: red }
      :where(.bb-tasks, [data-bb-plugin="tasks"]) * { box-sizing: border-box }
      @keyframes spin { to { transform: rotate(360deg) } }
      @-webkit-keyframes spin { from { opacity: 0 } }
      .group { &:hover { color: red } }`;
    const css = scoped(source);
    const rules: string[] = [];
    css.walkRules(rule => { rules.push(rule.selector); });
    expect(rules.slice(0, 5)).toEqual([
      '.bb-tasks .editor', '[data-bb-plugin="tasks"]',
      ':where(.bb-tasks, [data-bb-plugin="tasks"]) *', 'to', 'from',
    ]);
    expect(rules.at(-1)).toBe('&:hover');
  });

  it('keeps responsive variants and pseudo-elements inside the same scope', () => {
    const css = scoped('@media (min-width: 40rem) { .rounded { border-radius: 8px } } .placeholder::placeholder { color: gray }');
    const rules: string[] = [];
    css.walkRules(rule => { rules.push(rule.selector); });
    expect(rules).toHaveLength(2);
    expect(rules[0]).toContain('[data-bb-plugin="tasks"] *).rounded');
    expect(rules[1]).toContain('[data-bb-plugin="tasks"] *).placeholder::placeholder');
  });

  it('confines universal and element rules without producing invalid compound selectors', () => {
    const css = scoped('*, ::before, ::after, input { --tw-content: "" }');
    expect((css.first as postcss.Rule).selectors).toEqual(['*', '::before', '::after', 'input']
      .map(selector => `:where(.bb-tasks, [data-bb-plugin="tasks"]) ${selector}`));
  });
});
