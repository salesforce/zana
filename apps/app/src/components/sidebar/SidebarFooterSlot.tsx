import { type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

export const SIDEBAR_FOOTER_SLOT_ID = 'sidebar-footer-slot';

const useSlotElement = create<{ element: HTMLElement | null; setElement: (el: HTMLElement | null) => void }>((set) => ({
  element: null,
  setElement: (element) => set({ element })
}));

/**
 * Mount point at the bottom of the global sidebar, just above the utility bar.
 * Render once per rail; features contribute content through `SidebarFooterPortal`
 * so they never touch the nav logic (the onboarding resume pill lives here).
 */
export function SidebarFooterSlot(): ReactElement {
  const setElement = useSlotElement((s) => s.setElement);
  return <div ref={setElement} id={SIDEBAR_FOOTER_SLOT_ID} className="sidebar-footer-slot" data-testid="sidebar-footer-slot" />;
}

/** Renders children inside the sidebar footer slot; renders nothing while the sidebar is not mounted. */
export function SidebarFooterPortal({ children }: { children: ReactNode }): ReactElement | null {
  const element = useSlotElement((s) => s.element);
  return element ? createPortal(children, element) : null;
}
