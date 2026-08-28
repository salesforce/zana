import { describe, expect, it } from 'vitest';
import { mermaidSvgLayout } from './mermaid-svg-layout.js';

const FLOWCHART = [
  '<svg id="inbox-mermaid-0" width="100%" xmlns="http://www.w3.org/2000/svg"',
  ' class="flowchart" style="max-width: 1248px; height: 412px;" viewBox="0 0 1248 412"',
  ' role="graphics-document document"><g></g></svg>'
].join('');

describe('mermaidSvgLayout', () => {
  it('pins the viewBox aspect ratio and drops percentage/inline sizing', () => {
    const { svg, aspectRatio } = mermaidSvgLayout(FLOWCHART);
    expect(aspectRatio).toBe('1248 / 412');
    expect(svg).not.toMatch(/\bwidth="100%"/);
    expect(svg).not.toMatch(/\bheight="/);
    expect(svg).not.toMatch(/max-width/);
    expect(svg).toContain('viewBox="0 0 1248 412"');
    expect(svg).toContain('id="inbox-mermaid-0"');
    expect(svg).toContain('<g></g>');
  });

  it('keeps non-sizing styles on the root svg', () => {
    const { svg } = mermaidSvgLayout(
      '<svg width="100%" style="max-width: 10px; background: red; height: 4px;" viewBox="0 0 10 4"></svg>'
    );
    expect(svg).toContain('style="background: red"');
    expect(svg).not.toContain('max-width');
    expect(svg).not.toContain('height:');
  });

  it('returns null aspect ratio when viewBox is missing', () => {
    const { svg, aspectRatio } = mermaidSvgLayout('<svg width="100%" height="40"></svg>');
    expect(aspectRatio).toBeNull();
    expect(svg).not.toMatch(/\bwidth="/);
    expect(svg).not.toMatch(/\bheight="/);
  });

  it('reads a comma-separated viewBox', () => {
    expect(mermaidSvgLayout('<svg viewBox="0,0,20,10"></svg>').aspectRatio).toBe('20 / 10');
  });

  it('is idempotent across repeated calls', () => {
    const first = mermaidSvgLayout(FLOWCHART);
    const second = mermaidSvgLayout(FLOWCHART);
    expect(second).toEqual(first);
    expect(mermaidSvgLayout(first.svg)).toEqual(first);
  });
});
