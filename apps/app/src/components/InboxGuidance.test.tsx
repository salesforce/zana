// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ enabled: true, setNav: vi.fn(), setSettingsTab: vi.fn() }));
vi.mock('../store.js', () => ({
  useData: (pick: (s: { inboxGuidanceEnabled: boolean }) => unknown) => pick({ inboxGuidanceEnabled: state.enabled }),
  useUi: (pick: (s: { setNav: unknown; setSettingsTab: unknown }) => unknown) => pick({ setNav: state.setNav, setSettingsTab: state.setSettingsTab })
}));

import { InboxGuidance } from './InboxGuidance.js';

describe('InboxGuidance', () => {
  beforeEach(() => { state.enabled = true; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('renders nothing when guidance is disabled', () => {
    state.enabled = false;
    const view = render(<InboxGuidance />);
    expect(view.container.firstChild).toBeNull();
  });

  it('explains how to push and links to the inbox settings tab', () => {
    render(<InboxGuidance />);
    expect(screen.getByLabelText('Inbox guidance')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Hide in Settings/ }));
    expect(state.setNav).toHaveBeenCalledWith('settings');
    expect(state.setSettingsTab).toHaveBeenCalledWith('inbox');
  });
});
