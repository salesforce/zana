// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { SidebarFooterPortal, SidebarFooterSlot, SIDEBAR_FOOTER_SLOT_ID } from './SidebarFooterSlot.js';

afterEach(cleanup);

describe('SidebarFooterSlot', () => {
  it('renders portal content nowhere until the sidebar slot is mounted', () => {
    render(<SidebarFooterPortal><span>Pill</span></SidebarFooterPortal>);
    expect(screen.queryByText('Pill')).toBeNull();
  });

  it('moves portal content into the slot, and drops it when the slot unmounts', () => {
    const { rerender } = render(<><SidebarFooterSlot /><SidebarFooterPortal><span>Pill</span></SidebarFooterPortal></>);
    const slot = document.getElementById(SIDEBAR_FOOTER_SLOT_ID)!;
    expect(slot.className).toBe('sidebar-footer-slot');
    expect(slot.contains(screen.getByText('Pill'))).toBe(true);
    act(() => { rerender(<SidebarFooterPortal><span>Pill</span></SidebarFooterPortal>); });
    expect(screen.queryByText('Pill')).toBeNull();
  });
});
