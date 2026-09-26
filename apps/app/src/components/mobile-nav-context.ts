import { createContext, useContext } from 'react';

// Keep the provider and consumers on one context when the drawer's header is
// hot-reloaded. Recreating it in a component module can switch the rail back
// to desktop navigation while the mobile drawer is still displayed.
export const MobileNavDismiss = createContext<(() => void) | null>(null);
export const useMobileNavDismiss = () => useContext(MobileNavDismiss);
