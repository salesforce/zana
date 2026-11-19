// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InboxSquadProposalSurface, type InboxSquadProposalSurfaceProps } from './InboxSquadProposalSurface.js';

const base: InboxSquadProposalSurfaceProps = {
  hostAction: { status: 'pending' } as InboxSquadProposalSurfaceProps['hostAction'],
  ownershipLoading: false,
  ownershipError: false,
  projectAlive: true,
  reviewBusy: false,
  dismissBusy: false,
  reviewError: null,
  dismissError: null,
  onRetry: vi.fn(),
  onReview: vi.fn(),
  onDismiss: vi.fn()
};

afterEach(cleanup);

describe('InboxSquadProposalSurface plan check line', () => {
  it('colours each count by severity', () => {
    render(<InboxSquadProposalSurface {...base} planCheck={{ mustFix: 1, check: 2, fixedForYou: 3 }} />);
    const line = screen.getByTestId('inbox-plan-check');
    expect(line.textContent).toBe('Plan check: 1 Must fix before this can launch, 2 to check, 3 fixed for you. Review shows the details.');
    expect(line.querySelector('[data-severity="blocking"]')?.textContent).toBe('1 Must fix before this can launch');
    expect(line.querySelector('[data-severity="warning"]')?.textContent).toBe('2 to check');
    expect(line.querySelector('[data-severity="repair"]')?.textContent).toBe('3 fixed for you');
  });

  it('says no problems when every count is zero', () => {
    render(<InboxSquadProposalSurface {...base} planCheck={{ mustFix: 0, check: 0, fixedForYou: 0 }} />);
    expect(screen.getByTestId('inbox-plan-check').textContent).toContain('No problems found');
  });

  it('shows no line when the proposal carries no plan check', () => {
    render(<InboxSquadProposalSurface {...base} />);
    expect(screen.queryByTestId('inbox-plan-check')).toBeNull();
  });
});
