import { cellDisplay, discoverColumns, flattenRecords } from './soql-flatten.js';

export function SoqlResultsGrid(props: {
  records: Array<Record<string, unknown>>;
  search: string;
  totalSize?: number;
  hasMore?: boolean;
  loaded?: number;
  onLoadMore?: () => void;
  onLoadAll?: () => void;
  busy?: boolean;
}) {
  const flat = flattenRecords(props.records);
  const columns = discoverColumns(props.records);
  const needle = props.search.trim().toLowerCase();
  const rows = needle
    ? flat.filter((row) =>
        columns.some((col) => cellDisplay(row[col]).toLowerCase().includes(needle))
      )
    : flat;
  if (props.records.length === 0) {
    return (
      <div className="sf-soql-empty" data-testid="soql-results-empty">
        Run a query to see records.
      </div>
    );
  }
  return (
    <div className="sf-soql-results" data-testid="soql-results">
      <div className="sf-soql-results-meta">
        <span>
          {rows.length}
          {needle ? ` matching · ${flat.length} loaded` : ` loaded`}
          {props.totalSize != null ? ` of ${props.totalSize}` : ''}
        </span>
        {props.hasMore ? (
          <span className="sf-soql-results-pager">
            <button type="button" className="sf-soql-btn" disabled={props.busy} onClick={props.onLoadMore}>
              Load more
            </button>
            <button type="button" className="sf-soql-btn" disabled={props.busy} onClick={props.onLoadAll}>
              Load all
            </button>
          </span>
        ) : null}
      </div>
      <div className="sf-soql-table-wrap">
        <table className="sf-soql-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={String(row.Id ?? index)}>
                {columns.map((col) => (
                  <td key={col}>{cellDisplay(row[col])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
