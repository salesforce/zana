import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReasoningEffortPicker } from './ReasoningEffortPicker.js';
import {
  nextComposerReasoningLevel,
  reasoningEffortFill,
  thinkingEffortTitle,
  visibleComposerReasoningLevels
} from './reasoning-labels.js';

const options = [
  { value: 'none' as const, label: 'None' },
  { value: 'low' as const, label: 'Low' },
  { value: 'medium' as const, label: 'Medium' },
  { value: 'high' as const, label: 'High' },
  { value: 'xhigh' as const, label: 'X-High' }
];

describe('reasoningEffortFill', () => {
  it('maps the five thinking steps onto 0–3 bars', () => {
    expect(reasoningEffortFill('none')).toBe(0);
    expect(reasoningEffortFill('low')).toBe(1);
    expect(reasoningEffortFill('medium')).toBe(2);
    expect(reasoningEffortFill('high')).toBe(3);
    expect(reasoningEffortFill('xhigh')).toBe(3);
  });
});

describe('thinkingEffortTitle', () => {
  it('labels the trigger Thinking: <effort>', () => {
    expect(thinkingEffortTitle('low')).toBe('Thinking: Low');
    expect(thinkingEffortTitle('xhigh')).toBe('Thinking: X-High');
  });
});

describe('visibleComposerReasoningLevels', () => {
  it('hides Ultracode and Max from the composer picker', () => {
    expect(visibleComposerReasoningLevels([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'ultracode',
      'max',
      'ultra'
    ])).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'ultra']);
  });
});

describe('nextComposerReasoningLevel', () => {
  it('increments through visible efforts and wraps to the first', () => {
    const levels = ['none', 'low', 'medium', 'high', 'xhigh'] as const;
    expect(nextComposerReasoningLevel(levels, 'none')).toBe('low');
    expect(nextComposerReasoningLevel(levels, 'low')).toBe('medium');
    expect(nextComposerReasoningLevel(levels, 'medium')).toBe('high');
    expect(nextComposerReasoningLevel(levels, 'high')).toBe('xhigh');
    expect(nextComposerReasoningLevel(levels, 'xhigh')).toBe('none');
  });

  it('skips hidden Ultracode and Max when stepping', () => {
    expect(nextComposerReasoningLevel(
      ['low', 'medium', 'high', 'xhigh', 'ultracode', 'max'],
      'xhigh'
    )).toBe('low');
    expect(nextComposerReasoningLevel(
      ['low', 'medium', 'high', 'xhigh', 'ultracode', 'max'],
      'max'
    )).toBe('low');
  });
});

describe('ReasoningEffortPicker', () => {
  it('renders a compact thinking trigger without the effort word on the button', () => {
    const html = renderToStaticMarkup(
      <ReasoningEffortPicker
        value="low"
        options={options}
        onChange={() => undefined}
      />
    );
    expect(html).toContain('data-testid="reasoning-effort-picker-trigger"');
    expect(html).toContain('aria-label="Thinking: Low"');
    expect(html).toContain('title="Thinking: Low"');
    expect(html).toContain('reasoning-effort-bars');
    expect(html).not.toContain('Low</span>');
  });

  it('increments thinking on click instead of opening the menu', () => {
    const source = readFileSync(new URL('./ReasoningEffortPicker.tsx', import.meta.url), 'utf8');
    expect(source).toContain('onClick={increment}');
    expect(source).toContain('nextComposerReasoningLevel');
    expect(source).not.toContain('onClick={() => setOpen((current) => !current)}');
  });

  it('treats Max as X-High and does not keep Ultracode or Max as picker values', () => {
    const html = renderToStaticMarkup(
      <ReasoningEffortPicker
        value="max"
        options={[
          ...options,
          { value: 'ultracode', label: 'Ultracode' },
          { value: 'max', label: 'Max' }
        ]}
        onChange={() => undefined}
      />
    );
    expect(html).toContain('aria-label="Thinking: X-High"');
    expect(html).not.toContain('data-testid="reasoning-effort-ultracode"');
    expect(html).not.toContain('data-testid="reasoning-effort-max"');
  });

  it('hides when the model has no reasoning efforts', () => {
    const html = renderToStaticMarkup(
      <ReasoningEffortPicker
        value="medium"
        options={[]}
        onChange={() => undefined}
      />
    );
    expect(html).toBe('');
  });
});
