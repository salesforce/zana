import type { SObjectListEntry, SoqlChildRelationship, SoqlFieldDescribe, SoqlSObjectDescribe } from '../../../lib/soql-describe.js';
import { filterSObjectList } from '../../../lib/soql-describe.js';
import { parseQuery } from './soql-ast.js';
import { selectedFieldSet } from './soql-field-selection.js';

export function SoqlSchemaRail(props: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  search: string;
  onSearch: (value: string) => void;
  catalogs: { standard: SObjectListEntry[]; tooling: SObjectListEntry[] };
  useToolingApi: boolean;
  selected?: string;
  describe?: SoqlSObjectDescribe | null;
  soql: string;
  onSelectSObject: (name: string) => void;
  onToggleField: (path: string) => void;
  onToggleChild: (relationshipName: string, fieldName: string) => void;
  onInsert: (snippet: string) => void;
  onRefresh: () => void;
  busy?: boolean;
}) {
  if (props.collapsed) {
    return (
      <aside className="sf-soql-rail is-collapsed" data-testid="soql-schema-rail">
        <button type="button" className="sf-soql-rail-toggle" onClick={props.onToggleCollapsed} aria-label="Expand schema">
          ▸
        </button>
      </aside>
    );
  }
  const entries = filterSObjectList(
    props.useToolingApi ? props.catalogs.tooling : props.catalogs.standard,
    props.search
  ).filter((row) => row.queryable);
  const selected = selectedFieldSet(parseQuery(props.soql));
  return (
    <aside className="sf-soql-rail" data-testid="soql-schema-rail">
      <div className="sf-soql-rail-head">
        <span className="sf-soql-rail-title">Schema</span>
        <button type="button" className="sf-soql-btn" disabled={props.busy} onClick={props.onRefresh}>
          Refresh
        </button>
        <button type="button" className="sf-soql-rail-toggle" onClick={props.onToggleCollapsed} aria-label="Collapse schema">
          ▾
        </button>
      </div>
      <input
        className="sf-soql-search"
        value={props.search}
        onChange={(event) => props.onSearch(event.target.value)}
        placeholder="Search sObjects…"
        aria-label="Search sObjects"
      />
      <div className="sf-soql-rail-scroll">
        <div className="sf-soql-section-label">{props.useToolingApi ? 'Tooling' : 'Standard'}</div>
        {entries.slice(0, 200).map((row) => (
          <button
            key={`${row.source}:${row.name}`}
            type="button"
            className={`sf-soql-tree-btn${props.selected === row.name ? ' is-active' : ''}`}
            data-testid={`soql-sobject:${row.name}`}
            onClick={() => props.onSelectSObject(row.name)}
          >
            <span className="sf-soql-tree-name">{row.name}</span>
            <span className="sf-soql-tree-meta">{row.label}</span>
          </button>
        ))}
        {props.describe ? (
          <>
            <div className="sf-soql-section-label">Fields</div>
            {props.describe.fields.map((field) => (
              <FieldRow
                key={field.name}
                field={field}
                checked={selected.has(field.name)}
                onToggle={() => props.onToggleField(field.name)}
                onInsert={() => props.onInsert(field.relationshipName || field.name)}
              />
            ))}
            <div className="sf-soql-section-label">Relationships</div>
            {props.describe.childRelationships.map((rel) => (
              <ChildRow
                key={rel.relationshipName}
                rel={rel}
                checked={selected.has(`sub:${rel.relationshipName}.Id`) || selected.has(`sub:${rel.relationshipName}`)}
                onToggle={() => props.onToggleChild(rel.relationshipName, 'Id')}
                onInsert={() => props.onInsert(`(SELECT Id FROM ${rel.relationshipName})`)}
              />
            ))}
          </>
        ) : null}
      </div>
    </aside>
  );
}

function FieldRow(props: {
  field: SoqlFieldDescribe;
  checked: boolean;
  onToggle: () => void;
  onInsert: () => void;
}) {
  return (
    <div className="sf-soql-field-row">
      <label>
        <input type="checkbox" checked={props.checked} onChange={props.onToggle} />
        <span>{props.field.name}</span>
      </label>
      <button type="button" className="sf-soql-link" onClick={props.onInsert} title={props.field.type}>
        {props.field.type}
      </button>
    </div>
  );
}

function ChildRow(props: {
  rel: SoqlChildRelationship;
  checked: boolean;
  onToggle: () => void;
  onInsert: () => void;
}) {
  return (
    <div className="sf-soql-field-row">
      <label>
        <input type="checkbox" checked={props.checked} onChange={props.onToggle} />
        <span>{props.rel.relationshipName}</span>
      </label>
      <button type="button" className="sf-soql-link" onClick={props.onInsert}>
        {props.rel.childSObject}
      </button>
    </div>
  );
}
