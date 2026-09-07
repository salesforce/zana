const SKIP = new Set(['attributes', 'done', 'totalSize', 'nextRecordsUrl']);

export function flattenRecord(
  record: Record<string, unknown>,
  prefix = ''
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SKIP.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      out[path] = `${value.length} record${value.length === 1 ? '' : 's'}`;
      continue;
    }
    if (value && typeof value === 'object') {
      const nested = value as Record<string, unknown>;
      if (Array.isArray(nested.records)) {
        out[path] = `${nested.records.length} record${nested.records.length === 1 ? '' : 's'}`;
        continue;
      }
      Object.assign(out, flattenRecord(nested, path));
      continue;
    }
    out[path] = value;
  }
  return out;
}

export function discoverColumns(records: Array<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(flattenRecord(record))) {
      if (seen.has(key)) continue;
      seen.add(key);
      order.push(key);
    }
  }
  return order;
}

export function flattenRecords(records: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return records.map((row) => flattenRecord(row));
}

export function cellDisplay(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
