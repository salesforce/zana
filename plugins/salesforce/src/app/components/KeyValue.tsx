const MAX_DEPTH = 3;
const MAX_ENTRIES = 200;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isScalar = (value: unknown) => value == null || typeof value !== 'object';

function scalarText(value: unknown): string {
  return value == null ? '—' : String(value);
}

/** Flatten any value into `path: value` lines (used for chat prompts instead of raw JSON dumps). */
export function keyValueLines(value: unknown, prefix = '', depth = 0): string[] {
  if (isScalar(value)) return [`${prefix || 'value'}: ${scalarText(value)}`];
  const entries: Array<[string, unknown]> = Array.isArray(value) ? value.map((item, index) => [String(index + 1), item]) : Object.entries(value as object);
  const lines: string[] = [];
  for (const [key, item] of entries.slice(0, MAX_ENTRIES)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isScalar(item)) lines.push(`${path}: ${scalarText(item)}`);
    else if (depth + 1 >= MAX_DEPTH) lines.push(`${path}: ${JSON.stringify(item)}`);
    else lines.push(...keyValueLines(item, path, depth + 1));
  }
  if (entries.length > MAX_ENTRIES) lines.push(`… ${entries.length - MAX_ENTRIES} more`);
  return lines;
}

export const keyValueText = (value: unknown, limit = 8000) => keyValueLines(value).join('\n').slice(0, limit);

/** Shared key/value renderer replacing raw JSON dumps. Nested objects render as nested lists. */
export function KeyValueList({ value, depth = 0, className = 'sf-definition sf-kv' }: { value: unknown; depth?: number; className?: string }) {
  if (isScalar(value)) return <p className="sf-kv-scalar">{scalarText(value)}</p>;
  const entries: Array<[string, unknown]> = Array.isArray(value) ? value.map((item, index) => [String(index + 1), item]) : Object.entries(value as object);
  if (!entries.length) return <p className="sf-kv-scalar">{Array.isArray(value) ? '(empty list)' : '(empty)'}</p>;
  return (
    <dl className={className} data-testid="key-value">
      {entries.slice(0, MAX_ENTRIES).map(([key, item]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            {isScalar(item) ? scalarText(item)
              : depth + 1 >= MAX_DEPTH || (!isRecord(item) && !Array.isArray(item)) ? <code>{JSON.stringify(item)}</code>
              : <KeyValueList value={item} depth={depth + 1} className="sf-kv sf-kv-nested" />}
          </dd>
        </div>
      ))}
      {entries.length > MAX_ENTRIES && <div><dt>…</dt><dd>{entries.length - MAX_ENTRIES} more</dd></div>}
    </dl>
  );
}
