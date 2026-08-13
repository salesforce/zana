import type { SessionMetadataSnapshot } from '@shared/types';

/** Generic display for safe main-owned harness metadata. */
export function AgentMetadata({ metadata }: { metadata?: SessionMetadataSnapshot }) {
  if (!metadata?.sections.length) return null;

  return (
    <div className="agent-metadata" aria-live="polite">
      {metadata.sections.map((section) => (
        <section key={section.id} className="agent-metadata-section" aria-label={section.label}>
          <div className="agent-insight-label">{section.label}</div>
          <dl className="agent-metadata-values">
            {section.values.map((field) => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd>{field.value ?? 'Unavailable'}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
