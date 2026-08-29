import type { ReactNode } from 'react';

export function ExpandableLine({
  fullText,
  children
}: {
  fullText: string;
  children: ReactNode;
}) {
  return (
    <details className="thread-expandable-line" title={fullText}>
      <summary>{children}</summary>
    </details>
  );
}
