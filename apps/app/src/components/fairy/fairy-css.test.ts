import { describe, expect, it } from 'vitest';
import { readSourceText } from '../../__tests__/helpers/source-text.js';

const css = readSourceText(new URL('./fairy.css', import.meta.url));

describe('fairy.css', () => {
  it('defines keyframes for every animation it names', () => {
    const used = new Set(
      [...css.matchAll(/animation(?:-name)?:\s*([a-z][\w-]*)/g)].map((m) => m[1]).filter((n) => n !== 'none')
    );
    const defined = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(20);
    for (const name of used) expect(defined, name).toContain(name);
  });

  it('settles every scene under reduced motion', () => {
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.fairy-scene *');
    expect(reduced).toContain('animation: none !important');
    expect(reduced).toContain('.fairy-agents-outline { stroke-dashoffset: 0; }');
    expect(reduced).toContain('offset-distance: 100%');
  });
});
