// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThreadPlanPanel, type DurablePlanPanelView } from './ThreadPlanPanel.js';
afterEach(cleanup);
const plan: DurablePlanPanelView = {
  markdown: '# Converter plan', revision: 2, revisionSource: 'provider-draft', requestedExecutionMode: 'plan',
  progress: { completed: 0, total: 0 }, tasks: [],
  referencedBy: [{ threadId: 'author', taskId: null, role: 'Author', todosAssigned: 0 }]
};
const document = { markdown: plan.markdown, prompt: null, filePath: null, source: 'durable' as const };
describe('plan review actions', () => {
  it('shows a draft and revision without made-up progress or an empty author reference', () => {
    const revise = vi.fn(), implement = vi.fn();
    render(<ThreadPlanPanel document={document} durablePlan={plan} onRevise={revise} onImplement={implement} />);
    expect(screen.getByTestId('thread-plan-status').textContent).toBe('Draft');
    expect(screen.getByTestId('thread-plan-revision').textContent).toContain('Revision 2');
    expect(screen.queryByTestId('thread-plan-progress')).toBeNull();
    expect(screen.queryByTestId('thread-plan-referenced-by')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Revise plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Implement plan' }));
    expect(revise).toHaveBeenCalledOnce(); expect(implement).toHaveBeenCalledOnce();
  });
  it('blocks actions while busy and preserves native approval controls', () => {
    const implement = vi.fn();
    const view = render(<ThreadPlanPanel document={document} durablePlan={plan} onImplement={implement} actionsDisabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Implement plan' }));
    expect(implement).not.toHaveBeenCalled();
    view.rerender(<ThreadPlanPanel document={{ ...document, source: 'approval' }} durablePlan={plan} onImplement={implement} />);
    expect(screen.queryByRole('button', { name: 'Implement plan' })).toBeNull();
    view.rerender(<ThreadPlanPanel document={document} durablePlan={plan} onImplement={implement} actionPending />);
    expect(screen.getByRole('button', { name: 'Starting…' }).hasAttribute('disabled')).toBe(true);
  });
});
