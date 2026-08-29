import { ChevronRight } from 'lucide-react';
import { useUi } from '../../store.js';

/**
 * A collapsible rail section header. Clicking the label toggles `collapsed`
 * (persisted in the store under `sectionKey`); callers render the section body
 * only when not collapsed. An optional `action` renders on the right (e.g. the
 * manage-groups gear) and doesn't trigger the collapse.
 *
 * `variant`:
 *  - `'toggle'` (default) — leading chevron + label. Used where the header is
 *    the only chevron in its column (scheduler, settings, focus buckets).
 *  - `'divider'` — a hairline rule + label with the collapse chevron at the
 *    TRAILING edge. Used for the Projects rail's Remote/Local groups, where a
 *    leading chevron would sit in the same column as each project row's colored
 *    dot. The divider reads as a separator, not a tree node.
 */
export function SectionHeader({
  label,
  sectionKey,
  action,
  variant = 'toggle'
}: {
  label: string;
  sectionKey: string;
  action?: React.ReactNode;
  variant?: 'toggle' | 'divider';
}) {
  const collapsed = useUi((s) => !!s.collapsedSections[sectionKey]);
  const toggleSection = useUi((s) => s.toggleSection);
  if (variant === 'divider') {
    return (
      <button
        type="button"
        className="list-section-divider"
        onClick={() => toggleSection(sectionKey)}
        aria-expanded={!collapsed}
        title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      >
        <span className="list-section-divider-label">{label}</span>
        <span className="list-section-divider-rule" aria-hidden="true" />
        <ChevronRight
          size={11}
          className={`list-section-chevron ${collapsed ? '' : 'open'}`}
        />
      </button>
    );
  }
  return (
    <div className={`settings-scope-label settings-scope-label--toggle ${action ? 'settings-scope-label--action' : ''}`}>
      <button
        type="button"
        className="list-section-toggle"
        onClick={() => toggleSection(sectionKey)}
        aria-expanded={!collapsed}
        title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      >
        <ChevronRight size={11} className={`list-section-chevron ${collapsed ? '' : 'open'}`} />
        <span>{label}</span>
      </button>
      {action}
    </div>
  );
}
