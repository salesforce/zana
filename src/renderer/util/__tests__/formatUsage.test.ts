import { describe, it, expect } from 'vitest';
import { formatTokens, formatCost, shortModel, formatDuration } from '../formatUsage';

describe('formatTokens', () => {
  it('compacts thousands and millions', () => {
    expect(formatTokens(500)).toBe('500');
    expect(formatTokens(1_200)).toBe('1.2k');
    expect(formatTokens(44_900)).toBe('44.9k');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });
  it('renders zero / negative / non-finite as "0"', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(-5)).toBe('0');
    expect(formatTokens(NaN)).toBe('0');
  });
});

describe('formatCost', () => {
  it('formats to 2 decimals with a leading $', () => {
    expect(formatCost(12.3)).toBe('$12.30');
    expect(formatCost(0)).toBe('$0.00');
  });
  it('shows a non-zero sliver as <$0.01 so it never reads as free', () => {
    expect(formatCost(0.004)).toBe('<$0.01');
  });
  it('handles non-finite defensively', () => {
    expect(formatCost(Infinity)).toBe('$0.00');
  });
});

describe('shortModel', () => {
  it('strips the claude- prefix and trailing date', () => {
    expect(shortModel('claude-sonnet-4-5-20250929')).toBe('sonnet-4-5');
    expect(shortModel('claude-opus-4-8')).toBe('opus-4-8');
  });
  it('leaves an unrecognized id mostly intact', () => {
    expect(shortModel('mystery-model')).toBe('mystery-model');
  });
});

describe('formatDuration', () => {
  it('glosses ms into coarse minutes / hours / days', () => {
    expect(formatDuration(30_000)).toBe('<1m');
    expect(formatDuration(180_000)).toBe('3m');
    expect(formatDuration(5_400_000)).toBe('1.5h');
    expect(formatDuration(181_440_000)).toBe('2.1d');
  });
  it('renders zero / non-finite as an em dash', () => {
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(NaN)).toBe('—');
  });
});
