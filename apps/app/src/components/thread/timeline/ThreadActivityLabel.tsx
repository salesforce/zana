import { ChevronRight, Sparkle } from 'lucide-react';

/** Shared live-status treatment; motion is decorative, the label stays readable. */
export function ThreadActivityLabel({ label, expandable = false, elapsed = null }: {
  label: string;
  expandable?: boolean;
  elapsed?: string | null;
}) {
  return (
    <span className="thread-activity-label">
      <Sparkle size={13} className="thread-activity-spark" aria-hidden="true" />
      <span className="is-shimmer" role="status" aria-live="polite" aria-atomic="true">{label}</span>
      {/* Outside the live region so the ticking clock is never announced. */}
      {elapsed ? <span className="thread-activity-elapsed" aria-hidden="true">· {elapsed}</span> : null}
      {expandable ? <ChevronRight size={12} className="thread-timeline-work-chevron" aria-hidden="true" /> : null}
    </span>
  );
}
