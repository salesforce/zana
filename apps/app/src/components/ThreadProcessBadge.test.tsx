import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadProcessBadge } from './ThreadProcessBadge.js';

const withCount = (activeBackgroundCommandCount: number) => ({
  activity: {
    activeWorkflowCount: 0,
    activeBackgroundAgentCount: 0,
    activeBackgroundCommandCount,
    activeGoalCount: 0,
    activePlanModeCount: 0
  }
});

describe('ThreadProcessBadge', () => {
  it('renders nothing when no process is running', () => {
    expect(renderToStaticMarkup(<ThreadProcessBadge thread={withCount(0)} />)).toBe('');
    expect(renderToStaticMarkup(<ThreadProcessBadge thread={{}} />)).toBe('');
  });

  it('shows the running count with an accessible label', () => {
    const html = renderToStaticMarkup(<ThreadProcessBadge thread={withCount(2)} />);
    expect(html).toContain('data-testid="thread-process-badge"');
    expect(html).toContain('aria-label="2 background processes running"');
    expect(html).toContain('<svg');
    expect(html).toMatch(/<\/svg>2<\/span>$/);
  });
});
