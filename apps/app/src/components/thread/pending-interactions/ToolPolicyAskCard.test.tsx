/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolPolicyAskCard } from './ToolPolicyAskCard.js';

afterEach(cleanup);

const data = { kind: 'tool-policy-ask', toolName: 'Bash', prompt: 'Run rm?', inputPreview: 'rm -rf x' };
const setup = (over: Partial<Parameters<typeof ToolPolicyAskCard>[0]> = {}) => {
  const submit = vi.fn(async () => undefined);
  const cancel = vi.fn(async () => undefined);
  render(<MemoryRouter><ToolPolicyAskCard data={data} pluginId="p1" submit={submit} cancel={cancel} {...over} /></MemoryRouter>);
  return { submit, cancel };
};

describe('ToolPolicyAskCard', () => {
  it('shows tool, plugin, prompt and input preview', () => {
    setup();
    expect(screen.getByTestId('tool-policy-ask-prompt').textContent).toBe('Run rm?');
    expect(screen.getByTestId('tool-policy-ask-input').textContent).toBe('rm -rf x');
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText('p1')).toBeTruthy();
  });

  it('submits allow and deny decisions only', async () => {
    const { submit } = setup();
    fireEvent.click(screen.getByTestId('tool-policy-ask-allow'));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ decision: 'allow' }));
    fireEvent.click(screen.getByTestId('tool-policy-ask-deny'));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ decision: 'deny' }));
  });

  it('shows the refusal when the answer fails', async () => {
    setup({ submit: vi.fn(async () => { throw new Error('Human proof required'); }) });
    fireEvent.click(screen.getByTestId('tool-policy-ask-allow'));
    await screen.findByText('Human proof required');
  });

  it('falls back to a generic message for non-Error failures and reports cancel failures', async () => {
    setup({ submit: vi.fn(async () => { throw 'x'; }), cancel: vi.fn(async () => { throw new Error('cancel failed'); }) });
    fireEvent.click(screen.getByTestId('tool-policy-ask-allow'));
    await screen.findByText('Could not answer this request. Please try again.');
    fireEvent.click(screen.getByTestId('tool-policy-ask-dismiss'));
    await screen.findByText('cancel failed');
  });

  it('cancels through dismiss', async () => {
    const { cancel } = setup();
    fireEvent.click(screen.getByTestId('tool-policy-ask-dismiss'));
    await waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it('renders nothing for malformed card data', () => {
    const { container } = render(<ToolPolicyAskCard data={{ nope: 1 }} pluginId="p" submit={vi.fn()} cancel={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });
});
