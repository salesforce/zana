import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExpandableLine } from './ExpandableLine.js';

describe('ExpandableLine', () => {
  it('renders script as a native expandable code line', () => {
    const html = renderToStaticMarkup(
      <ExpandableLine fullText={'for d in */; do echo "$d"; done'}>
        $ for d in */; do echo "$d"; done
      </ExpandableLine>
    );
    expect(html).toContain('thread-expandable-line');
    expect(html).toContain('<details');
    expect(html).toContain('<summary>');
    expect(html).toContain('$ for d in */');
    expect(html).toContain('title="');
  });
});
