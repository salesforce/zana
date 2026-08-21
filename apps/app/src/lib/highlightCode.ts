import hljs from 'highlight.js/lib/common';

/**
 * Map a file path to a highlight.js language id, or null when we have no good
 * match (the caller then renders plain, unhighlighted text).
 *
 * Only languages present in highlight.js' `common` bundle are referenced —
 * that's the same bundle rehype-highlight loads for the markdown path, so we
 * add no extra weight. JSX/TSX collapse onto javascript/typescript (the common
 * bundle has no separate tsx grammar, and the base grammars tolerate JSX).
 */
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  pl: 'perl',
  lua: 'lua',
  r: 'r',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  graphql: 'graphql',
  gql: 'graphql',
  diff: 'diff',
  patch: 'diff',
  makefile: 'makefile',
  mk: 'makefile'
};

/** Filenames (no extension, or extension-insensitive) that map to a language. */
const NAME_TO_LANG: Record<string, string> = {
  dockerfile: 'bash',
  makefile: 'makefile',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.gitignore': 'plaintext'
};

/**
 * Resolve a highlight.js language id for a file path, or null when the file is
 * markdown (rendered separately) or has no recognized mapping.
 */
export function languageForPath(path: string): string | null {
  const base = path.split(/[/\\]/).pop()?.toLowerCase() ?? '';
  const byName = NAME_TO_LANG[base];
  if (byName) return byName === 'plaintext' ? null : byName;

  const dot = base.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = base.slice(dot + 1);
  const lang = EXT_TO_LANG[ext];
  if (!lang) return null;
  // Guard against a grammar missing from the bundle at runtime.
  return hljs.getLanguage(lang) ? lang : null;
}

/**
 * Highlight `code` for the given file path. Returns the language-tagged HTML
 * string and the resolved language, or null when the path has no mapping so
 * the caller can fall back to plain text.
 *
 * The returned HTML is safe to inject: highlight.js HTML-escapes the source
 * before wrapping tokens in spans, so no raw user content reaches the DOM as
 * markup. This mirrors the markdown path, where rehype-highlight does the same.
 */
export function highlightForPath(
  path: string,
  code: string
): { html: string; language: string } | null {
  const language = languageForPath(path);
  if (!language) return null;
  try {
    const { value } = hljs.highlight(code, { language, ignoreIllegals: true });
    return { html: value, language };
  } catch {
    return null;
  }
}

/**
 * Highlight a raw unified-diff string via highlight.js' own `diff` grammar
 * (`+`/`-`/hunk-header lines → `.hljs-addition`/`.hljs-deletion`/`.hljs-meta`),
 * already styled by the app's loaded `github-dark.css`. Returns escaped HTML,
 * or null if the `diff` grammar is unexpectedly missing from the bundle.
 */
export function highlightDiff(patch: string): string | null {
  if (!hljs.getLanguage('diff')) return null;
  try {
    return hljs.highlight(patch, { language: 'diff', ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
