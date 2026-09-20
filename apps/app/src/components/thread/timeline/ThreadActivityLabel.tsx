import { ChevronRight } from 'lucide-react';

/** Shared live-status treatment; motion is decorative, the label stays readable. */
export function ThreadActivityLabel({ label, expandable = false }: {
  label: string;
  expandable?: boolean;
}) {
  return (
    <span className="thread-activity-label">
      <span className="thread-activity-dot" aria-hidden="true" />
      <span role="status" aria-live="polite" aria-atomic="true">{label}</span>
      {expandable ? <ChevronRight size={12} className="thread-timeline-work-chevron" aria-hidden="true" /> : null}
    </span>
  );
}
