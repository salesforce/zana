const ANSI_CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const ANSI_SIMPLE = /\u001b[@-Z\\-_]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_OSC, '').replace(ANSI_CSI, '').replace(ANSI_SIMPLE, '');
}

const SGR_COLORS: Record<number, string> = {
  30: 'var(--ansi-0, #4e4e4e)',
  31: 'var(--ansi-1, #d14)',
  32: 'var(--ansi-2, #2a6)',
  33: 'var(--ansi-3, #c90)',
  34: 'var(--ansi-4, #4c8dff)',
  35: 'var(--ansi-5, #a6c)',
  36: 'var(--ansi-6, #2aa)',
  37: 'var(--ansi-7, #eee)',
  90: 'var(--ansi-8, #888)',
  91: 'var(--ansi-9, #f66)',
  92: 'var(--ansi-10, #6c6)',
  93: 'var(--ansi-11, #fc6)',
  94: 'var(--ansi-12, #6af)',
  95: 'var(--ansi-13, #c8f)',
  96: 'var(--ansi-14, #6cc)',
  97: 'var(--ansi-15, #fff)'
};

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Convert a subset of SGR color codes to themed HTML spans. */
export function ansiToHtml(text: string): string {
  const cleaned = text.replace(ANSI_OSC, '').replace(ANSI_SIMPLE, '');
  const parts: string[] = [];
  let last = 0;
  let open = false;
  const csi = /\u001b\[([0-9;]*)m/g;
  let match: RegExpExecArray | null;
  while ((match = csi.exec(cleaned))) {
    parts.push(escapeHtml(cleaned.slice(last, match.index)));
    last = match.index + match[0].length;
    const codes = (match[1] ?? '0').split(';').map((code) => Number(code) || 0);
    if (open) {
      parts.push('</span>');
      open = false;
    }
    for (const code of codes) {
      if (code === 0) continue;
      const color = SGR_COLORS[code];
      if (color) {
        parts.push(`<span style="color:${color}">`);
        open = true;
      }
    }
  }
  parts.push(escapeHtml(cleaned.slice(last)));
  if (open) parts.push('</span>');
  return parts.join('');
}
