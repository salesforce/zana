import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DelayedLoading,
  LOADING_REVEAL_DELAY_MS,
  Skeleton,
  StencilForm,
  StencilLines,
  StencilList
} from './Skeleton.js';

describe('Skeleton', () => {
  it('renders a pulse bar with the shared class and optional width', () => {
    const html = renderToStaticMarkup(<Skeleton width="80px" data-testid="bar" />);
    expect(html).toContain('zcc-skeleton');
    expect(html).toContain('width:80px');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-testid="bar"');
  });
});

describe('stencil layouts', () => {
  it('renders varying-width lines with a status label', () => {
    const html = renderToStaticMarkup(
      <StencilLines label="Loading models" widths={['80px', '112px', '96px', '128px']} />
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Loading models"');
    expect(html).toContain('sr-only');
    expect(html).toContain('Loading models');
    expect(html.split('zcc-skeleton').length - 1).toBe(4);
    expect(html).toContain('width:80px');
    expect(html).toContain('width:128px');
  });

  it('renders icon-plus-bar list rows', () => {
    const html = renderToStaticMarkup(<StencilList label="Loading inbox" widths={['75%', '60%']} />);
    expect(html).toContain('zcc-stencil-list-row');
    expect(html.split('zcc-stencil-list-icon').length - 1).toBe(2);
    expect(html).toContain('aria-label="Loading inbox"');
  });

  it('renders label-plus-value form rows', () => {
    const html = renderToStaticMarkup(
      <StencilForm
        label="Loading settings"
        rows={[{ labelWidth: '56px', valueWidth: '160px' }]}
      />
    );
    expect(html).toContain('zcc-stencil-form-row');
    expect(html).toContain('zcc-stencil-form-label');
    expect(html).toContain('zcc-stencil-form-value');
    expect(html).toContain('aria-label="Loading settings"');
  });
});

describe('DelayedLoading', () => {
  it('waits 200ms before revealing children, matching BB', () => {
    expect(LOADING_REVEAL_DELAY_MS).toBe(200);
    const source = readFileSync(new URL('./Skeleton.tsx', import.meta.url), 'utf8');
    expect(source).toContain('window.setTimeout(() => setVisible(true), delayMs)');
    expect(source).toContain('return visible ? children : null');
    expect(renderToStaticMarkup(
      <DelayedLoading>
        <span>ready</span>
      </DelayedLoading>
    )).toBe('');
  });
});

describe('skeleton CSS', () => {
  it('defines a shared pulse and honors reduced motion', () => {
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    expect(css).toContain('.zcc-skeleton {');
    expect(css).toContain('@keyframes zcc-skeleton-pulse');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });
});
