/**
 * Map a file path to a Monaco language id, or undefined when there's no good
 * match (Monaco then renders plain text). Shared by the Explorer's diff/editor
 * and the agent-modal Changes diff so the two can't drift on how a file's
 * language is guessed. Monaco ids differ from highlight.js' (`shell` vs `bash`,
 * `markdown` present, `html` not `xml`), so this is its own table rather than
 * reusing `highlightCode.ts`.
 */
const EXT_TO_MONACO_LANG: Record<string, string> = {
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
  md: 'markdown',
  mdx: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  xml: 'xml',
  svg: 'xml',
  dockerfile: 'dockerfile'
};

export function languageFromPath(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  return EXT_TO_MONACO_LANG[ext];
}
