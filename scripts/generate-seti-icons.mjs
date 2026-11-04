#!/usr/bin/env node
// Generates the Explorer's Seti file-icon tables and stylesheet from the
// vendored VS Code theme (apps/app/src/assets/seti/vs-seti-icon-theme.json).
//
//   pnpm gen:seti-icons
//
// Output is deterministic (sorted keys) so re-running leaves no diff.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const themePath = resolve(root, 'apps/app/src/assets/seti/vs-seti-icon-theme.json');
export const outDir = resolve(root, 'apps/app/src/lib/fileIcons');

/**
 * VS Code resolves many Seti icons through language ids, and the renderer has
 * no language registry, so the common built-in extension → language
 * associations are folded in here. Explicit `fileExtensions` entries win.
 */
export const EXTENSION_LANGUAGES = {
  bat: 'bat', cmd: 'bat',
  bicep: 'bicep',
  c: 'c', h: 'c',
  clj: 'clojure', cljs: 'clojure', cljc: 'clojure',
  coffee: 'coffeescript',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hh: 'cpp', hpp: 'cpp', hxx: 'cpp',
  cs: 'csharp', csx: 'csharp',
  css: 'css',
  cu: 'cuda-cpp', cuh: 'cuda-cpp',
  dart: 'dart',
  dockerfile: 'dockerfile',
  ex: 'elixir', exs: 'elixir',
  elm: 'elm',
  erb: 'erb',
  fs: 'fsharp', fsi: 'fsharp', fsx: 'fsharp',
  gd: 'godot',
  go: 'go',
  gradle: 'gradle',
  groovy: 'groovy',
  haml: 'haml',
  handlebars: 'handlebars', hbs: 'handlebars',
  hs: 'haskell',
  hx: 'haxe',
  htm: 'html', html: 'html', xhtml: 'html',
  jade: 'jade', pug: 'jade',
  java: 'java',
  cjs: 'javascript', es6: 'javascript', js: 'javascript', mjs: 'javascript',
  jsx: 'javascriptreact',
  jinja: 'jinja', j2: 'jinja',
  json: 'json', jsonc: 'jsonc',
  jl: 'julia',
  kt: 'kotlin', kts: 'kotlin',
  tex: 'latex',
  less: 'less',
  lua: 'lua',
  makefile: 'makefile', mk: 'makefile',
  md: 'markdown', markdown: 'markdown',
  matlab: 'matlab', m: 'matlab',
  pas: 'pascal', pp: 'pascal',
  pl: 'perl', pm: 'perl',
  php: 'php',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  pug: 'pug',
  py: 'python', pyw: 'python', ipynb: 'jupyter',
  r: 'r',
  rst: 'restructuredtext',
  rb: 'ruby',
  rs: 'rust',
  sass: 'sass', scss: 'scss',
  scala: 'scala', sc: 'scala',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript',
  sql: 'sql',
  swift: 'swift',
  tcl: 'tcl',
  tf: 'terraform',
  tex: 'tex',
  cts: 'typescript', mts: 'typescript', ts: 'typescript',
  tsx: 'typescriptreact',
  vala: 'vala',
  vue: 'vue',
  xml: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml', svg: 'xml',
  yaml: 'yaml', yml: 'yaml'
};

/** Well-known basenames VS Code assigns a language (and thus an icon) to. */
export const FILENAME_LANGUAGES = {
  '.dockerignore': 'ignore',
  '.env': 'dotenv',
  '.gitignore': 'ignore',
  '.npmignore': 'ignore',
  dockerfile: 'dockerfile',
  gnumakefile: 'makefile',
  makefile: 'makefile'
};

export function generateSetiIcons(customThemePath = themePath, customOutDir = outDir) {
  const theme = JSON.parse(readFileSync(customThemePath, 'utf8'));
  const defs = theme.iconDefinitions;
  const lower = (map) => Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [k.toLowerCase(), v]));

  const fileNames = lower(theme.fileNames);
  const fileExtensions = lower(theme.fileExtensions);
  const languageIds = theme.languageIds || {};
  const DEFAULT_ICON = theme.file;

  for (const [ext, lang] of Object.entries(EXTENSION_LANGUAGES)) {
    if (fileExtensions[ext] === undefined && languageIds[lang] !== undefined) {
      fileExtensions[ext] = languageIds[lang];
    }
  }
  for (const [name, lang] of Object.entries(FILENAME_LANGUAGES)) {
    if (fileNames[name] === undefined && languageIds[lang] !== undefined) {
      fileNames[name] = languageIds[lang];
    }
  }

  const used = new Set([DEFAULT_ICON, ...Object.values(fileNames), ...Object.values(fileExtensions)]);

  // dark icon id -> light icon id, from the theme's `light` overrides.
  const lightFor = { [DEFAULT_ICON]: theme.light?.file };
  for (const kind of ['fileNames', 'fileExtensions', 'languageIds']) {
    const dark = kind === 'fileNames' ? theme.fileNames : kind === 'fileExtensions' ? theme.fileExtensions : theme.languageIds;
    for (const [key, lightId] of Object.entries(theme.light?.[kind] ?? {})) {
      const darkId = dark?.[key];
      if (darkId === undefined) continue;
      if (lightFor[darkId] !== undefined && lightFor[darkId] !== lightId) {
        throw new Error(`Ambiguous light icon for ${darkId}: ${lightFor[darkId]} vs ${lightId}`);
      }
      lightFor[darkId] = lightId;
    }
  }

  const char = (id) => {
    const code = parseInt(defs[id].fontCharacter.replace('\\', ''), 16);
    return `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
  };
  const sorted = (obj) => Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const q = (s) => JSON.stringify(s);
  const table = (name, obj) =>
    `export const ${name}: Readonly<Record<string, string>> = {\n${sorted(obj)
      .map(([k, v]) => `  ${q(k)}: ${q(v)}`)
      .join(',\n')}\n};\n`;

  const ids = [...used].sort();
  for (const id of ids) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Unsafe icon id for a CSS class: ${id}`);
    if (!defs[id]) throw new Error(`Missing icon definition: ${id}`);
  }

  const ts = `// GENERATED by scripts/generate-seti-icons.mjs from assets/seti/vs-seti-icon-theme.json.
// Do not edit by hand; run \`pnpm gen:seti-icons\`.

/** Icon id -> Seti font character. */
export const ICONS: Readonly<Record<string, string>> = {
${ids.map((id) => `  ${q(id)}: "${char(id)}"`).join(',\n')}
};

/** Icon used when nothing else matches. */
export const DEFAULT_ICON = ${q(DEFAULT_ICON)};

/** Lowercased basename -> icon id. */
${table('FILE_NAMES', fileNames)}
/** Lowercased extension (without the leading dot; may be compound, e.g. "d.ts") -> icon id. */
${table('FILE_EXTENSIONS', fileExtensions)}`;

  const css = `/* GENERATED by scripts/generate-seti-icons.mjs; run \`pnpm gen:seti-icons\`. */
@font-face {
  font-family: 'seti';
  src: url('../../assets/seti/seti.woff') format('woff');
  font-weight: normal;
  font-style: normal;
  font-display: block;
}

${ids.filter((id) => defs[id].fontColor).map((id) => `.seti-${id} { color: ${defs[id].fontColor}; }`).join('\n')}

${ids
  .filter((id) => lightFor[id] && defs[lightFor[id]]?.fontColor && defs[lightFor[id]].fontColor !== defs[id].fontColor)
  .map((id) => `:root[data-theme='light'] .seti-${id} { color: ${defs[lightFor[id]].fontColor}; }`)
  .join('\n')}
`;

  if (customOutDir) {
    writeFileSync(resolve(customOutDir, 'seti.generated.ts'), ts);
    writeFileSync(resolve(customOutDir, 'seti.generated.css'), css);
  }

  return { ids, fileNames, fileExtensions, ts, css };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const result = generateSetiIcons();
  console.log(`seti icons: ${result.ids.length} icons, ${Object.keys(result.fileNames).length} filenames, ${Object.keys(result.fileExtensions).length} extensions`);
}
