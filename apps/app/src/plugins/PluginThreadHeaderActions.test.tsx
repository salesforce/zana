// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { clearPluginSlots, interpretPluginApp } from './plugin-slots.js';
import { PluginOwnedThreadIcon, PluginOwnedThreadTitle } from './PluginThreadHeaderActions.js';

afterEach(() => { cleanup(); clearPluginSlots('notes'); });

it('opens the owning plugin’s tool and preserves the title on other conversations', () => {
  interpretPluginApp('notes', definePluginApp(app => {
    app.slots.threadPanelAction({ id: 'profile', title: 'Profile', component: () => null,
      experimental_ownedThreadTitle: ({ threadId, openPanel }) => <button onClick={openPanel}>{threadId}</button> });
  }));
  const onOpen = vi.fn();
  const props = { title: 'Conversation', threadId: 'thread-a', onOpen };
  const view = render(<PluginOwnedThreadTitle {...props} owner="other" />);
  expect(screen.getByText('Conversation')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<PluginOwnedThreadTitle {...props} owner="notes" />);
  fireEvent.click(screen.getByRole('button', { name: 'thread-a' }));
  expect(onOpen).toHaveBeenCalledWith('notes', 'profile');
});

it('renders the registered icon only for its owner and passes through the row size and thread ID', () => {
  interpretPluginApp('notes', definePluginApp(app => {
    app.slots.threadPanelAction({
      id: 'profile', title: 'Profile', component: () => null,
      experimental_ownedThreadIcon: ({ threadId, size }) => <span>{threadId} at {size}</span>
    });
  }));
  const props = { threadId: 'thread-a', size: 20, fallback: <span>Provider</span> };
  const view = render(<PluginOwnedThreadIcon {...props} owner="other" />);
  expect(screen.getByText('Provider')).toBeTruthy();
  view.rerender(<PluginOwnedThreadIcon {...props} owner="notes" />);
  expect(screen.getByText('thread-a at 20')).toBeTruthy();
  expect(screen.queryByText('Provider')).toBeNull();
});
