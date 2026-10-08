/** Numbers, scales and data files for the site kit. Pure, so pages and tests share them. */

/** How a chart or `Kit.format` writes a number. */
export type NumberFormat = 'number' | 'integer' | 'percent' | 'compact' | Intl.NumberFormatOptions;

const PRESETS: Record<Exclude<NumberFormat, Intl.NumberFormatOptions>, Intl.NumberFormatOptions> = {
  number: { maximumFractionDigits: 2 },
  integer: { maximumFractionDigits: 0 },
  // Values are fractions: 0.62 is 62%.
  percent: { style: 'percent', maximumFractionDigits: 1 },
  compact: { notation: 'compact', maximumFractionDigits: 1 }
};

const formatters = new Map<string, Intl.NumberFormat>();
const MAX_FORMATTERS = 50;

export function formatNumber(value: number | null | undefined, format: NumberFormat = 'number', locale?: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '–';
  const options = typeof format === 'string' ? (PRESETS[format] ?? PRESETS.number) : format;
  const key = `${locale ?? ''}\u0000${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    if (formatters.size < MAX_FORMATTERS) formatters.set(key, formatter);
  }
  return formatter.format(value);
}

export interface Ticks {
  min: number;
  max: number;
  ticks: number[];
}

/** A step of 1, 2 or 5 times a power of ten, near `span / count`. */
function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

/** Round axis bounds and the ticks between them, about `count` of them. */
export function niceTicks(min: number, max: number, count = 5): Ticks {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    min = min >= 0 && min - pad < 0 ? 0 : min - pad;
    max += pad;
  }
  const step = niceStep(max - min, count);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  const round = (value: number) => Number(value.toFixed(decimals));
  const low = round(Math.floor(min / step) * step);
  const high = round(Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let index = 0; ; index += 1) {
    const tick = round(low + index * step);
    if (tick > high + step / 2) break;
    ticks.push(tick);
  }
  return { min: low, max: high, ticks };
}

/** Maps a domain onto a range, linearly. */
export function linearScale(domain: readonly [number, number], range: readonly [number, number]): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** About how wide `text` renders at `size` px in the system sans; SVG text cannot be measured before layout. */
export function textWidth(text: string, size = 12): number {
  let units = 0;
  for (const char of text) units += /[ilj.,:;'|!]/.test(char) ? 0.3 : /[mwMW@%]/.test(char) ? 0.85 : /[A-Z0-9]/.test(char) ? 0.65 : 0.55;
  return units * size;
}

/** `text`, shortened with an ellipsis to fit `width` px. */
export function fitText(text: string, width: number, size = 12): string {
  if (textWidth(text, size) <= width) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}…`, size) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/** A table cell read as a number: `1,234`, `62%`, `$4.20` and `−3` count; anything else is null. */
export function toNumber(text: string): number | null {
  const cleaned = text.trim().replace(/[\s,$€£%]/g, '').replace(/^−/, '-');
  return NUMBER.test(cleaned) ? Number(cleaned) : null;
}

/**
 * Rows of a CSV file as objects keyed by the header row. Quoted fields may hold
 * commas, quotes (`""`) and line breaks; numeric fields become numbers.
 */
export function parseCsv(text: string): Array<Record<string, string | number>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((cells) => cells.some((cell) => cell !== ''));
  if (!header) return [];
  return body.map((cells) =>
    Object.fromEntries(
      header.map((name, column) => {
        const cell = cells[column] ?? '';
        const number = cell.trim() === '' ? null : NUMBER.test(cell.trim()) ? Number(cell.trim()) : null;
        return [name.trim(), number ?? cell];
      })
    )
  );
}
