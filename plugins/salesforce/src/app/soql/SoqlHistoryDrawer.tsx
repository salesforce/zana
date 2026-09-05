import type { SoqlHistoryItem } from '../../../lib/soql-history.js';
import { SOQL_EXAMPLES } from './soql-examples.js';

export function SoqlHistoryDrawer(props: {
  open: boolean;
  recent: SoqlHistoryItem[];
  saved: SoqlHistoryItem[];
  onClose: () => void;
  onSelect: (soql: string, useToolingApi: boolean, includeDeleted: boolean) => void;
  onSave: () => void;
  onRemove: (kind: 'recent' | 'saved', id: string) => void;
}) {
  if (!props.open) return null;
  return (
    <aside className="sf-soql-history" data-testid="soql-history">
      <div className="sf-soql-rail-head">
        <span className="sf-soql-rail-title">Queries</span>
        <button type="button" className="sf-soql-btn" onClick={props.onSave}>
          Save current
        </button>
        <button type="button" className="sf-soql-btn" onClick={props.onClose} aria-label="Close query list">
          Close
        </button>
      </div>
      <div className="sf-soql-section-label">Examples</div>
      {SOQL_EXAMPLES.map((example) => (
        <button
          key={example.id}
          type="button"
          className="sf-soql-tree-btn"
          data-testid={`soql-example:${example.id}`}
          onClick={() => props.onSelect(example.soql, example.useToolingApi, false)}
        >
          <span className="sf-soql-tree-name">{example.name}</span>
          <span className="sf-soql-tree-meta">{example.useToolingApi ? 'Tooling' : 'REST'}</span>
        </button>
      ))}
      <div className="sf-soql-section-label">Saved</div>
      {props.saved.length === 0 ? <p className="sf-soql-empty">No saved queries.</p> : null}
      {props.saved.map((item) => (
        <HistoryRow
          key={item.id}
          item={item}
          onSelect={props.onSelect}
          onRemove={() => props.onRemove('saved', item.id)}
        />
      ))}
      <div className="sf-soql-section-label">Recent</div>
      {props.recent.length === 0 ? <p className="sf-soql-empty">No recent queries.</p> : null}
      {props.recent.map((item) => (
        <HistoryRow
          key={item.id}
          item={item}
          onSelect={props.onSelect}
          onRemove={() => props.onRemove('recent', item.id)}
        />
      ))}
    </aside>
  );
}

function HistoryRow(props: {
  item: SoqlHistoryItem;
  onSelect: (soql: string, useToolingApi: boolean, includeDeleted: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <div className="sf-soql-history-row">
      <button
        type="button"
        className="sf-soql-tree-btn"
        onClick={() => props.onSelect(props.item.soql, props.item.useToolingApi, props.item.includeDeleted)}
      >
        <span className="sf-soql-tree-name">{props.item.name || props.item.soql.split('\n')[0]}</span>
      </button>
      <button type="button" className="sf-soql-link" onClick={props.onRemove} aria-label="Remove query">
        ×
      </button>
    </div>
  );
}
