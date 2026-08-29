import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadContextMeter } from './ThreadContextMeter.js';
import { threadContextMeterView } from './thread-context-meter.js';

describe('threadContextMeterView', () => {
  it('formats the Cursor-style card copy for estimated usage', () => {
    expect(threadContextMeterView({
      usedTokens: 48_000,
      modelContextWindow: 1_000_000,
      estimated: true
    })).toEqual({
      usedPct: 5,
      title: 'Estimated context',
      usedLabel: '5% used',
      leftLabel: '95% left',
      tokensLabel: '48k / 1m tokens'
    });
  });

  it('drops the estimated title and compact fractions', () => {
    expect(threadContextMeterView({
      usedTokens: 1_500,
      modelContextWindow: 200_000,
      estimated: false
    })).toEqual({
      usedPct: 1,
      title: 'Context',
      usedLabel: '1% used',
      leftLabel: '99% left',
      tokensLabel: '1.5k / 200k tokens'
    });
  });

  it('returns null when the window is missing', () => {
    expect(threadContextMeterView({
      usedTokens: 12,
      modelContextWindow: 0,
      estimated: false
    })).toBeNull();
  });
});

describe('ThreadContextMeter', () => {
  it('renders the usage card beside a compact trigger', () => {
    const html = renderToStaticMarkup(
      <ThreadContextMeter usage={{ usedTokens: 48_000, modelContextWindow: 1_000_000, estimated: true }} />
    );
    expect(html).toContain('data-testid="thread-context-window"');
    expect(html).toContain('Estimated context');
    expect(html).toContain('5% used');
    expect(html).toContain('48k / 1m tokens');
    expect(html).toContain('95% left');
    expect(html).toContain('thread-context-meter-pct');
    expect(html).toContain('thread-context-meter-card');
  });

  it('renders nothing without usage', () => {
    expect(renderToStaticMarkup(<ThreadContextMeter usage={null} />)).toBe('');
  });
});
