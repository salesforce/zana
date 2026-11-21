// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import zanaGlyph from '../../assets/zana-glyph.svg';
import { ZanaIcon } from './ZanaIcon.js';

afterEach(cleanup);

it('uses the existing tintable Zana silhouette at default and requested sizes', () => {
  const view = render(<ZanaIcon />);
  const mark = view.container.firstElementChild as HTMLElement;
  expect(mark.style.mask).toContain(zanaGlyph);
  expect(mark.style.backgroundColor).toMatch(/currentcolor/i);
  expect(mark.style.width).toBe('24px');
  expect(mark.style.height).toBe('24px');
  expect(mark.getAttribute('aria-hidden')).toBe('true');
  view.rerender(<ZanaIcon size={48} className="welcome-mark" />);
  expect(mark.style.width).toBe('48px');
  expect(mark.style.height).toBe('48px');
  expect(mark.classList.contains('welcome-mark')).toBe(true);
});
