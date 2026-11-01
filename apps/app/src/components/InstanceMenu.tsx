import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, Globe, Laptop, Power } from 'lucide-react';
import { hasDesktopBridge } from '../lib/app-surface.js';
import { product } from '../lib/product-client.js';
import { Modal } from './Modal.js';
import { SharedInstancePicker } from '../views/settings/SharedInstancePicker.js';
import './instance-menu.css';

/** The desktop is a client of this local Zana or an account-selected instance. */
export function InstanceMenu() {
  const [picking, setPicking] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false; };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  useEffect(() => {
    if (hasDesktopBridge() && hash === '#remote-access.shared-instance') {
      setPicking(true);
      void navigate({ pathname, search, hash: '' }, { replace: true });
    }
  }, [pathname, search, hash, navigate]);
  if (!hasDesktopBridge()) return null;
  return <>
    <details className="instance-menu" ref={menu} onKeyDown={event => {
      if (event.key === 'Escape') { menu.current!.open = false; menu.current!.querySelector('summary')!.focus(); }
    }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) menu.current!.open = false; }}>
      <summary aria-label="Zana switcher: This computer" title="This computer · Switch Zana"><Laptop size={14} aria-hidden="true" /><span>This computer</span><ChevronDown size={11} aria-hidden="true" /></summary>
      <div className="instance-menu-popover">
        <div className="instance-menu-current"><small>You’re using</small><strong><Laptop size={17} aria-hidden="true" />This computer</strong><p>Projects and agents run on this computer.</p></div>
        <button type="button" aria-label="Open another computer…" onClick={() => { menu.current!.open = false; setPicking(true); }}><Globe size={16} aria-hidden="true" /><span>Open another computer…<small>Open its projects and agents.</small></span></button>
        <div className="instance-menu-separator" />
        <button type="button" aria-label="Quit Zana" onClick={() => { menu.current!.open = false; void product.menubar.quit(); }}><Power size={16} aria-hidden="true" /><span>Quit Zana<small>Close the desktop app on this computer.</small></span></button>
      </div>
    </details>
    {picking && <Modal title="Open another computer" className="instance-picker-modal" onClose={() => setPicking(false)}><SharedInstancePicker onOpened={() => setPicking(false)} /></Modal>}
  </>;
}
