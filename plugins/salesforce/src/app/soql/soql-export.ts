import { cellDisplay } from './soql-flatten.js';

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function recordsToCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const header = columns.map(csvEscape).join(',');
  const body = rows.map((row) => columns.map((col) => csvEscape(cellDisplay(row[col]))).join(','));
  return `\uFEFF${[header, ...body].join('\n')}`;
}

export function recordsToJson(rows: Array<Record<string, unknown>>): string {
  return `${JSON.stringify(rows, null, 2)}\n`;
}

export function recordsToTsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const header = columns.join('\t');
  const body = rows.map((row) => columns.map((col) => cellDisplay(row[col]).replace(/\t/g, ' ')).join('\t'));
  return [header, ...body].join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
