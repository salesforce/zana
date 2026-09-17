import type { SalesforceOperation } from "../../../lib/workbench-contract.js";
import {
  operationResultView,
  resultEntryEvidence,
} from "./operation-results.js";

export function OperationResults({
  operation,
  onAddToPrompt,
}: {
  operation: SalesforceOperation;
  onAddToPrompt?(text: string): void;
}) {
  const view = operationResultView(operation);
  if (operation.data == null) return null;
  return (
    <div
      className="sf-operation-results"
      data-testid="salesforce-operation-results"
    >
      {view.preview && (
        <p className="sf-muted sf-small">
          Preview only. Listed changes have not been applied.
        </p>
      )}
      {view.metrics.length > 0 && (
        <dl className="sf-result-metrics">
          {view.metrics.map(({ label, value }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {view.emptyPreview && (
        <p className="sf-muted">No changes listed in this preview.</p>
      )}
      {!view.sections.length && !view.metrics.length && !view.emptyPreview && (
        <p className="sf-muted">
          No structured details in this report. Open the retained JSON to
          inspect the available evidence.
        </p>
      )}
      {view.sections.map((section, index) => (
        <section
          key={index}
          aria-label={section.title}
          className="sf-result-section"
        >
          <h4>
            {section.title}{" "}
            <span className="sf-badge">{section.entries.length} listed</span>
          </h4>
          <ul className="sf-result-list">
            {section.entries.map((entry, index) => (
              <li key={index}>
                <div className="sf-result-heading">
                  <strong>{entry.title}</strong>
                  <span
                    className={`sf-badge ${entry.tone ? `sf-${entry.tone}` : ""}`}
                  >
                    {entry.status}
                  </span>
                </div>
                {entry.location && (
                  <p className="sf-muted sf-small">{entry.location}</p>
                )}
                {entry.message && (
                  <pre className="sf-result-message">{entry.message}</pre>
                )}
                {entry.stack && (
                  <details>
                    <summary>Stack trace</summary>
                    <pre className="sf-code">{entry.stack}</pre>
                  </details>
                )}
                {onAddToPrompt && (
                  <button
                    className="sf-btn quiet"
                    type="button"
                    aria-label={`Add ${entry.title} to prompt`}
                    onClick={() =>
                      onAddToPrompt(resultEntryEvidence(operation, entry))
                    }
                  >
                    Add to prompt
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {view.truncated && (
        <p className="sf-muted sf-small">
          Showing up to 200 details. Open the retained JSON for other available
          evidence.
        </p>
      )}
      <details className="sf-result-raw">
        <summary>Retained report JSON</summary>
        <p className="sf-muted sf-small">
          Stored evidence is size limited; large reports may be shortened.
        </p>
        <pre className="sf-code">{JSON.stringify(operation.data, null, 2)}</pre>
      </details>
    </div>
  );
}
