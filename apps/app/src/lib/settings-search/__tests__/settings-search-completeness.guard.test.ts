import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS } from '@/views/settings/settings-navigation';
import { deriveNavEntries } from '../registry';
import { normalize } from '../corpus';
import { ALLOWED_FILES, ALLOWED_STRINGS } from '../completeness-allowlist';
import { SECTION_SOURCES, SETTINGS_SOURCE_DIRS, type SearchSection } from '../guard-config';
import type { SettingsSearchEntry } from '../types';

// Completeness guard (design §3.5): every user-visible literal in the Settings
// UI must be findable through some entry of its section. Enforced page by page.
//
// Parsed with `@babel/parser` (a declared root devDependency; TypeScript 7 is the
// native port and has no in-process JS parser API). JSX text and JSX attribute
// strings are read RAW (`extra.raw`), so an `&amp;` in source is compared as
// written, never entity-decoded.

interface Node {
  type: string;
  [key: string]: unknown;
}

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NON_CHILD_KEYS = new Set(['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens']);

function isNode(value: unknown): value is Node {
  return !!value && typeof value === 'object' && typeof (value as Node).type === 'string';
}

function childNodes(node: Node): Node[] {
  const out: Node[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (NON_CHILD_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item);
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out;
}

function rawOf(node: Node): string | undefined {
  return (node.extra as { raw?: string } | undefined)?.raw;
}

/** Settings primitives plus the page-local row components. */
export const ROW_COMPONENTS = new Set([
  'Section', 'Field', 'ToggleSwitch', 'CheckboxField', 'SettingsActionRow', 'ChipField', 'TextArgsField',
  'PField', 'OpenerRow', 'HarnessRow'
]);
const TEXT_ATTRS = new Set(['label', 'title', 'help', 'desc']);

function jsxName(node: Node | undefined): string {
  if (!node) return '';
  if (node.type === 'JSXIdentifier') return node.name as string;
  if (node.type === 'JSXMemberExpression') return `${jsxName(node.object as Node)}.${jsxName(node.property as Node)}`;
  if (node.type === 'JSXNamespacedName') return `${jsxName(node.namespace as Node)}:${jsxName(node.name as Node)}`;
  return '';
}

/** A string literal or a template literal without substitutions, through an expression container. */
function staticString(node: Node | undefined | null): string | undefined {
  if (!node) return undefined;
  if (node.type === 'StringLiteral') return node.value as string;
  if (node.type === 'TemplateLiteral' && (node.expressions as unknown[]).length === 0) {
    return ((node.quasis as Node[])[0].value as { cooked?: string }).cooked ?? undefined;
  }
  if (node.type === 'JSXExpressionContainer') return staticString(node.expression as Node);
  return undefined;
}

/** A JSX attribute value: quoted strings raw (as written), braces as an expression. */
function attrString(value: Node | undefined | null): string | undefined {
  if (!value) return undefined;
  if (value.type === 'StringLiteral') {
    const raw = rawOf(value);
    return raw !== undefined ? raw.slice(1, -1) : (value.value as string);
  }
  return staticString(value);
}

function jsxText(node: Node, out: string[]): void {
  if (node.type === 'JSXText') {
    out.push(rawOf(node) ?? (node.value as string));
    return;
  }
  const str = node.type === 'JSXExpressionContainer' ? staticString(node) : undefined;
  if (str !== undefined) {
    out.push(str);
    return;
  }
  for (const child of childNodes(node)) jsxText(child, out);
}

function keyName(key: Node | undefined): string | undefined {
  if (!key) return undefined;
  if (key.type === 'Identifier') return key.name as string;
  if (key.type === 'StringLiteral') return key.value as string;
  return undefined;
}

/** Collect the searchable literals from one source text (exported shape for fixtures). */
export function collectLiterals(sourceText: string, _fileName = 'fixture.tsx'): string[] {
  const ast = parse(sourceText, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true }) as unknown as Node;
  const out: string[] = [];
  const add = (raw: string | undefined) => {
    const n = normalize(raw ?? '');
    if (n) out.push(n);
  };

  const visitOptionsArray = (node: Node) => {
    const walk = (n: Node) => {
      if (n.type === 'ObjectProperty') {
        const name = keyName(n.key as Node);
        if (name === 'label' || name === 'title') add(staticString(n.value as Node));
      }
      for (const child of childNodes(n)) walk(child);
    };
    walk(node);
  };

  const visit = (node: Node) => {
    if (node.type === 'JSXOpeningElement') {
      const tag = jsxName(node.name as Node);
      const isRow = ROW_COMPONENTS.has(tag);
      for (const attr of node.attributes as Node[]) {
        if (attr.type !== 'JSXAttribute') continue;
        const name = jsxName(attr.name as Node);
        const value = attr.value as Node | null;
        if (isRow && TEXT_ATTRS.has(name)) {
          const s = attrString(value);
          if (s !== undefined) add(s);
          else if (value?.type === 'JSXExpressionContainer' && (value.expression as Node).type !== 'JSXEmptyExpression') {
            const parts: string[] = [];
            jsxText(value.expression as Node, parts);
            add(parts.join(' '));
          }
        } else if (name === 'options' && value) {
          visitOptionsArray(value);
        } else if (tag === 'option' && name === 'label') {
          add(attrString(value));
        }
      }
    }
    if (node.type === 'JSXElement' && jsxName((node.openingElement as Node).name as Node) === 'option') {
      const parts: string[] = [];
      for (const c of node.children as Node[]) jsxText(c, parts);
      add(parts.join(' '));
    }
    for (const child of childNodes(node)) visit(child);
  };
  visit(ast);
  return [...new Set(out)];
}

function listSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== '__tests__') walk(full);
      } else if (name.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(name)) {
        out.push(relative(SRC_ROOT, full).split(sep).join('/'));
      }
    }
  };
  for (const d of SETTINGS_SOURCE_DIRS) walk(join(SRC_ROOT, d));
  return out.sort();
}

const entryModules = import.meta.glob<{ default?: readonly SettingsSearchEntry[]; entries?: readonly SettingsSearchEntry[] }>(
  '../entries/*.ts',
  { eager: true }
);

function entriesBySection(): Map<string, SettingsSearchEntry[]> {
  const out = new Map<string, SettingsSearchEntry[]>();
  for (const [path, mod] of Object.entries(entryModules)) {
    const section = path.replace(/^.*\//, '').replace(/\.ts$/, '');
    out.set(section, [...(mod.entries ?? mod.default ?? [])]);
  }
  return out;
}

/** Normalised label/help/option texts an entry set can satisfy. */
function haystack(entries: readonly SettingsSearchEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    out.push(normalize(e.label));
    if (e.help) out.push(normalize(e.help));
    for (const o of e.options ?? []) out.push(normalize(o));
  }
  return out;
}

/** Whole-word containment, so "add" is not satisfied by "address". */
function containsWords(hay: string, needle: string): boolean {
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
    const before = at === 0 || !/[\p{L}\p{N}]/u.test(hay[at - 1]);
    const end = at + needle.length;
    const after = end === hay.length || !/[\p{L}\p{N}]/u.test(hay[end]);
    if (before && after) return true;
  }
  return false;
}

export function findUncovered(literals: readonly string[], entries: readonly SettingsSearchEntry[], allowed: ReadonlySet<string>): string[] {
  const hay = haystack(entries);
  return literals.filter((l) => !allowed.has(l) && !hay.some((h) => containsWords(h, l)));
}

function allowedFor(section: string): Set<string> {
  return new Set(ALLOWED_STRINGS.filter((a) => a.section === section).map((a) => normalize(a.text)));
}

const navEntries = deriveNavEntries();

function checkSection(section: SearchSection, entries: readonly SettingsSearchEntry[]): string[] {
  const pool = [...navEntries.filter((e) => e.section === section), ...entries];
  const missing: string[] = [];
  for (const file of SECTION_SOURCES[section] ?? []) {
    const full = join(SRC_ROOT, file);
    if (!existsSync(full)) {
      missing.push(`${file}: mapped in guard-config.ts but does not exist`);
      continue;
    }
    for (const l of findUncovered(collectLiterals(readFileSync(full, 'utf8'), file), pool, allowedFor(section))) {
      missing.push(`${file}: "${l}"`);
    }
  }
  return missing;
}

describe('settings-search completeness guard', () => {
  const bySection = entriesBySection();
  const allSections: SearchSection[] = [...SETTINGS_SECTIONS.map((s) => s.id), 'project'];

  it('indexes every section, covering every literal in its sources', () => {
    const problems: string[] = [];
    for (const section of allSections) {
      const entries = bySection.get(section);
      if (!entries) {
        problems.push(`missing entries/${section}.ts`);
        continue;
      }
      problems.push(...checkSection(section, entries).map((m) => `[${section}] ${m}`));
    }
    expect(problems).toEqual([]);
  });

  it('knows no entries file for an unknown section', () => {
    for (const section of bySection.keys()) expect(allSections).toContain(section);
  });

  it('maps every scanned source file to a section', () => {
    const mapped = new Set(Object.values(SECTION_SOURCES).flat());
    const allowed = new Set(ALLOWED_FILES.map((a) => a.file));
    const unmapped = listSourceFiles().filter(
      (f) => !mapped.has(f) && !allowed.has(f) && collectLiterals(readFileSync(join(SRC_ROOT, f), 'utf8'), f).length > 0
    );
    expect(unmapped).toEqual([]);
  });

  it('keeps allowlist entries justified', () => {
    for (const a of [...ALLOWED_STRINGS, ...ALLOWED_FILES]) expect(a.reason.trim().length).toBeGreaterThan(10);
  });

  it('keeps every mapped source file on disk', () => {
    for (const files of Object.values(SECTION_SOURCES)) for (const f of files) expect(existsSync(join(SRC_ROOT, f))).toBe(true);
  });

  describe('fixtures', () => {
    const entry = (over: Partial<SettingsSearchEntry>): SettingsSearchEntry => ({
      id: 'x.y', section: 'global', label: 'Theme', kind: 'setting', ...over
    });

    it('collects literals from primitives, help JSX, options and page-local rows', () => {
      const lits = collectLiterals(`
        const a = <Field label="Theme" help={<>Pick <b>a</b> theme</>}>
          <select><option>Dark</option><option label="Light" /></select></Field>;
        const b = <ToggleSwitch label={'Auto close'} desc="Closes idle agents" />;
        const c = <HarnessRow title="Claude" />;
        const d = <SegmentedControl options={[{ label: 'Compact' }]} />;
        const e = <div label="ignored" />;
      `);
      expect(lits).toEqual(expect.arrayContaining(['theme', 'pick a theme', 'dark', 'light', 'auto close', 'closes idle agents', 'claude', 'compact']));
      expect(lits).not.toContain('ignored');
    });

    it('ignores dynamic expressions', () => {
      expect(collectLiterals('const a = <Field label={name} help={`x ${y}`} />;')).toEqual([]);
    });

    it('FAILS when a literal has no entry', () => {
      const lits = collectLiterals('<Field label="Theme" help="Brand new help"/>');
      expect(findUncovered(lits, [entry({})], new Set())).toEqual(['brand new help']);
    });

    it('passes when label, help or options cover the literals (case/diacritics-insensitive)', () => {
      const lits = collectLiterals('<Field label="Thème" help="Pick one"><option>Dark</option></Field>');
      const covered = [entry({ label: 'theme', help: 'Please PICK one now', options: ['dark'] })];
      expect(findUncovered(lits, covered, new Set())).toEqual([]);
    });

    it('does not let a literal hide inside a longer word', () => {
      const lits = collectLiterals('<Field label="Add"/>');
      expect(findUncovered(lits, [entry({ label: 'Address book' })], new Set())).toEqual(['add']);
      expect(findUncovered(lits, [entry({ help: 'Add a thing' })], new Set())).toEqual([]);
    });

    it('lets the allowlist exclude a literal', () => {
      const lits = collectLiterals('<Field label="Theme" help="Internal"/>');
      expect(findUncovered(lits, [entry({})], new Set(['internal']))).toEqual([]);
    });
  });
});
