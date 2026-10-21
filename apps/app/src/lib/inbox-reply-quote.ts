const MAX_QUOTE_CHARS = 2000;

/** Quote `selection` into a reply draft, ending on a `- ` bullet ready to type. */
export function formatReplyQuote(currentDraft: string, selection: string): string {
  let text = selection.replace(/\r\n?/g, '\n').trim();
  if (!text) return currentDraft;

  if (text.length > MAX_QUOTE_CHARS) {
    const head = text.slice(0, MAX_QUOTE_CHARS);
    const cut = head.search(/\s\S*$/);
    text = `${(cut > 0 ? head.slice(0, cut) : head).trimEnd()}…`;
  }

  const quoted = text
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n');
  const base = currentDraft.trimEnd();
  return `${base ? `${base}\n\n` : ''}${quoted}\n- `;
}
