import { useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { product } from '../lib/product-client.js';
import { applyTheme, resolveTheme, useData, useUi } from '../store.js';

/** Uses the same persisted appearance setting and live config sync as Settings. */
export function TitlebarThemeToggle() {
  const theme = useData(state => state.theme);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const label = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  const toggle = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const next = await product.config.set({ theme: theme === 'light' ? 'dark' : 'light' });
      applyTheme(next.theme);
      useData.setState({ theme: resolveTheme(next.theme) });
    } catch {
      useUi.getState().pushToast("Couldn't change appearance. Try again.", 'error');
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return <button type="button" className="titlebar-theme" aria-label={label} title={label}
    disabled={pending} onClick={() => void toggle()}>
    {theme === 'light' ? <Moon size={15} aria-hidden="true" /> : <Sun size={15} aria-hidden="true" />}
  </button>;
}
