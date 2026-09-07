const LANGUAGE_BY_EXTENSION = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  xml: 'xml',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  rs: 'rust',
  go: 'go',
  swift: 'swift',
  java: 'java',
  kt: 'kotlin',
  cs: 'csharp',
  py: 'python',
  pyi: 'python',
  rb: 'ruby',
  php: 'php',
  lua: 'lua',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  sql: 'sql',
  graphql: 'graphql',
  tf: 'hcl',
  dockerfile: 'dockerfile',
  dart: 'dart'
};

export const CLAIMED_EXTENSIONS = Object.keys(LANGUAGE_BY_EXTENSION);

export function languageForPath(path) {
  const name = path.split(/[/\\]/).pop() ?? path;
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === name.length - 1) return 'plaintext';
  const extension = name.slice(dotIndex + 1).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext';
}
