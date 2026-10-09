import { cellDisplay, discoverColumns, flattenRecords } from './soql-flatten.js';
import { useWidthTier } from '../studio/useWidthTier.js';
import { EmptyState, LoadingState } from '../components/SalesforceState.js';

const NARROW_BREAKPOINT = [520] as const;

export function SoqlResultsGrid(props: {
  hasRun?: boolean;
  onSelectRecord?(record: Record<string, unknown>): void;
  records: Array<Record<string, unknown>>;
  search: string;
  totalSize?: number;
  hasMore?: boolean;
  loaded?: number;
  onLoadMore?: () => void;
  onLoadAll?: () => void;
  busy?: boolean;
}) {
  const [widthRef, tier] = useWidthTier(NARROW_BREAKPOINT);
  const narrow = tier === 0;
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
      <div data-testid="soql-results-empty">
        {props.busy ? <LoadingState art="data" label="Running your query…" hint="Fetching records from the selected org." /> :
          <EmptyState art="data" title={props.hasRun ? 'No records matched this query.' : 'Run a query to see records.'}>
            {props.hasRun ? 'Try adjusting the filters or choosing another object.' : 'Choose an object, select your fields, and explore the results here.'}
          </EmptyState>}
      </div>
    );
  }
  return (
    <div className="sf-soql-results" data-testid="soql-results" ref={widthRef}>
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
      {rows.length === 0 && <EmptyState compact art="search" title="No matching rows">Try a different search. Your loaded records are still here.</EmptyState>}
      {narrow ? (
        <div className="sf-soql-cards" data-testid="soql-cards">
          {rows.map((row, index) => {
            const [titleCol, ...rest] = columns.includes('Name') ? ['Name', ...columns.filter(col => col !== 'Name')] : columns;
            const title = cellDisplay(row[titleCol!]);
            return (
              <div className="sf-soql-card" key={String(row.Id ?? index)}>
                {props.onSelectRecord
                  ? <button type="button" className="sf-link sf-soql-card-title" onClick={() => props.onSelectRecord?.(props.records[flat.indexOf(row)])}>{title}</button>
                  : <b className="sf-soql-card-title">{title}</b>}
                {rest.map(col => <div className="sf-soql-card-row" key={col}><span>{col}</span><span>{cellDisplay(row[col])}</span></div>)}
              </div>
            );
          })}
        </div>
      ) : (
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
                  <td key={col}>{props.onSelectRecord && (col === 'Name' || col === 'Id') ? <button type="button" className="sf-link" onClick={() => props.onSelectRecord?.(props.records[flat.indexOf(row)])}>{cellDisplay(row[col])}</button> : cellDisplay(row[col])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
