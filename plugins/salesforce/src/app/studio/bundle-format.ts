/** Display helpers for read-only bundle tabs: agent series, file roles and a light source highlighter. */

export interface AgentRef { path: string; label: string }
/** One agent, or three or more agents that differ only by a trailing number (`Voice_Agent_26` … `Voice_Agent_39`). */
export type AgentGroup = { kind: 'one'; agent: AgentRef } | { kind: 'series'; prefix: string; first: string; last: string; agents: Array<AgentRef & { suffix: string }> };

const SERIES_MIN = 3;
const NUMBERED = /^(.*\D)(\d+)$/;
const agentLabel = (path: string) => (path.split('/').pop() ?? path).replace(/\.agent$/, '');

export function groupAgents(paths: readonly string[]): AgentGroup[] {
  const rows = paths.map(path => { const label = agentLabel(path); const match = label.match(NUMBERED); return { path, label, prefix: match?.[1], suffix: match?.[2] ?? '' }; });
  const series = new Map<string, typeof rows>();
  for (const row of rows) if (row.prefix !== undefined) series.set(row.prefix, [...(series.get(row.prefix) ?? []), row]);
  const groups: AgentGroup[] = [];
  const placed = new Set<string>();
  for (const row of rows) {
    const members = row.prefix !== undefined ? series.get(row.prefix) ?? [] : [];
    if (row.prefix === undefined || members.length < SERIES_MIN) { groups.push({ kind: 'one', agent: { path: row.path, label: row.label } }); continue; }
    if (placed.has(row.prefix)) continue;
    placed.add(row.prefix);
    const agents = [...members].sort((a, b) => Number(a.suffix) - Number(b.suffix)).map(({ path, label, suffix }) => ({ path, label, suffix }));
    groups.push({ kind: 'series', prefix: row.prefix, first: agents[0].suffix, last: agents[agents.length - 1].suffix, agents });
  }
  return groups;
}

export type SourceLang = 'markup' | 'script' | 'style' | 'plain';

/** `orderCard.html` in the `orderCard` bundle is its template; other files keep their name. */
export function fileRole(path: string, bundle: string): { label: string; ext: string; lang: SourceLang } {
  const base = path.split('/').pop() ?? path;
  const ext = base.endsWith('.js-meta.xml') ? 'xml' : (base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : '');
  const roles: Record<string, string> = { [`${bundle}.html`]: 'template', [`${bundle}.js`]: 'controller', [`${bundle}.ts`]: 'controller', [`${bundle}.css`]: 'styles', [`${bundle}.js-meta.xml`]: 'meta' };
  const lang: SourceLang = ext === 'html' || ext === 'xml' ? 'markup' : ext === 'js' || ext === 'ts' || ext === 'json' ? 'script' : ext === 'css' ? 'style' : 'plain';
  return { label: roles[base] ?? base, ext: ext.toUpperCase(), lang };
}

export interface Token { text: string; kind?: 'tag' | 'attr' | 'string' | 'comment' | 'expr' | 'keyword' }

export const HIGHLIGHT_LIMIT = 100_000;
const MARKUP = /(<!--[\s\S]*?-->)|(<\/?[A-Za-z][^>]*>)|(\{[^{}\n]*\})/g;
const IN_TAG = /(<\/?[A-Za-z][\w:-]*|\/?>)|(\s[\w:.@-]+)(?==)|("[^"]*"|'[^']*')|(\{[^{}]*\})/g;
const SCRIPT = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(import|export|from|default|class|extends|const|let|var|function|return|if|else|for|of|in|async|await|this|new|true|false|null|undefined)\b/g;
const STYLE = /(\/\*[\s\S]*?\*\/)|("[^"\n]*"|'[^'\n]*')/g;

function scan(source: string, pattern: RegExp, emit: (match: RegExpMatchArray, out: Token[]) => void): Token[] {
  const out: Token[] = [];
  let at = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > at) out.push({ text: source.slice(at, index) });
    emit(match, out);
    at = index + match[0].length;
  }
  if (at < source.length) out.push({ text: source.slice(at) });
  return out;
}

/** Colour cues only; the tokens always join back to `source`. Large files stay plain. */
export function highlight(source: string, lang: SourceLang): Token[] {
  if (lang === 'plain' || source.length > HIGHLIGHT_LIMIT) return [{ text: source }];
  if (lang === 'markup') return scan(source, MARKUP, (match, out) => {
    if (match[1]) out.push({ text: match[1], kind: 'comment' });
    else if (match[3]) out.push({ text: match[3], kind: 'expr' });
    else out.push(...scan(match[2], IN_TAG, (part, inner) => inner.push({
      text: part[0], kind: part[1] ? 'tag' : part[2] ? 'attr' : part[3] ? 'string' : 'expr'
    })));
  });
  if (lang === 'style') return scan(source, STYLE, (match, out) => out.push({ text: match[0], kind: match[1] ? 'comment' : 'string' }));
  return scan(source, SCRIPT, (match, out) => out.push({ text: match[0], kind: match[1] ? 'comment' : match[2] ? 'string' : 'keyword' }));
}

/** A one-line roster for a tooltip: series fold to `Voice_Agent_26–39`, and past `limit` entries the rest is counted. */
export function agentSummary(paths: readonly string[], limit = 10): string {
  const groups = groupAgents(paths);
  const names = groups.slice(0, limit).map(group => group.kind === 'one' ? group.agent.label : `${group.prefix}${group.first}–${group.last} (${group.agents.length})`);
  const rest = groups.slice(limit).reduce((sum, group) => sum + (group.kind === 'one' ? 1 : group.agents.length), 0);
  return rest ? `${names.join(', ')} and ${rest} more` : names.join(', ');
}
