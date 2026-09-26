import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, Ellipsis } from 'lucide-react';
import type { SidebarRailItem } from './SidebarRail.js';

/** A touch navigation layout over the same destinations and badges as desktop. */
export function MobileSidebarNav({ items, navAriaLabel, renderItem }: {
  items: readonly SidebarRailItem[];
  navAriaLabel: string;
  renderItem(id: string): ReactNode;
}) {
  const tools = items.filter((item) => item.kind === 'row' && item.mobileGroup === 'tools');
  const featured = items.filter((item) => item.kind === 'row' && item.mobileGroup === 'featured');
  const primary = items.filter((item) => item.kind === 'row' && !item.mobileGroup);
  const sections = items.filter((item) => item.kind === 'section');
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsId = useId();
  return (
    <nav className="mobile-sidebar-nav" aria-label={navAriaLabel} data-testid="sidebar-navigation">
      {featured.length > 0 && (
        <div className="mobile-nav-featured mobile-nav-primary">
          {featured.map((item) => renderItem(item.id))}
        </div>
      )}
      <div className="mobile-sidebar-scroll">
        <div className="mobile-nav-primary">{primary.map((item) => renderItem(item.id))}</div>
        {tools.length > 0 && (
          <section className="mobile-nav-tools">
            <button
              type="button"
              className="mobile-nav-tools-toggle"
              aria-expanded={toolsOpen}
              aria-controls={toolsId}
              onClick={() => setToolsOpen((open) => !open)}
            >
              <Ellipsis size={18} aria-hidden="true" />
              <span>More</span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            <div id={toolsId} className="mobile-nav-tools-list" hidden={!toolsOpen}>
              {tools.map((item) => renderItem(item.id))}
            </div>
          </section>
        )}
        {sections.map((item) => renderItem(item.id))}
      </div>
    </nav>
  );
}
