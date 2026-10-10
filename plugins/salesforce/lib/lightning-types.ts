/**
 * Lightning Types: the `complex_data_type_name` an Agent Script action input or output declares, and the
 * `lightningTypes/<Name>/` bundles (schema.json plus per-channel renderer/editor config) that define custom ones.
 * Read-only and bounded; bundle paths come from the confined project walk, never from renderer input.
 */
import { basename, join, relative } from 'node:path';
import { resolveUnderRoot } from './dx-project.js';
import type { ProjectActionIndex } from './action-source.js';
import type { LightningTypeProperty, LightningTypeView } from './studio-contract.js';
import type { SalesforceDeps } from './types.js';

export const LIGHTNING_TYPE_LIMITS = { refs: 120, files: 12, fileBytes: 256_000, properties: 200 } as const;

const REF_PATTERN = /\bcomplex_data_type_name\s*:\s*["']?([^"'\s#]{1,200})/g;
const NAME = '[A-Za-z][A-Za-z0-9_]{0,79}';
const TYPE_REF = new RegExp(`^(?:(${NAME})__)?(${NAME})$`);

export interface LightningTypeRef { ref: string; standard: boolean; namespace?: string; bundle: string }

/** `lightning__textType` is standard, `c__Order` a local bundle, `ns__Order` a namespaced one. Apex class types are not Lightning Types. */
export function parseLightningTypeRef(ref: string): LightningTypeRef | null {
  const match = TYPE_REF.exec(ref.trim());
  if (!match || match[2].includes('__') || match[1]?.includes('__')) return null;
  const [, namespace, bundle] = match;
  if (namespace === 'lightning') return { ref, standard: true, namespace, bundle };
  if (!namespace) return { ref, standard: false, bundle };
  return { ref, standard: false, ...(namespace === 'c' ? {} : { namespace }), bundle };
}

/** Distinct Lightning Type references declared in one Agent Script source. */
export function referencedLightningTypes(source: string): string[] {
  const seen = new Set<string>();
  for (const match of source.matchAll(REF_PATTERN)) {
    if (parseLightningTypeRef(match[1])) seen.add(match[1]);
    if (seen.size >= LIGHTNING_TYPE_LIMITS.refs) break;
  }
  return [...seen];
}

/** The project bundle a reference resolves to; a managed namespace only matches the project's own. */
export function lightningTypeBundlePath(index: ProjectActionIndex, ref: string): string | undefined {
  const parsed = parseLightningTypeRef(ref);
  if (!parsed || parsed.standard) return undefined;
  if (parsed.namespace && parsed.namespace !== index.namespace) return undefined;
  return index.lightningTypes.get(parsed.bundle)?.[0];
}

/** A file over the cap is listed but not shown: the bounded reader refuses it rather than returning a prefix. */
function readBounded(deps: SalesforceDeps, path: string): { content: string; truncated: boolean } | null {
  let raw: string | null;
  try { raw = deps.readFileBounded ? deps.readFileBounded(path, LIGHTNING_TYPE_LIMITS.fileBytes) : deps.readFile(path); }
  catch { return { content: '', truncated: true }; }
  if (raw === null) return null;
  return raw.length > LIGHTNING_TYPE_LIMITS.fileBytes ? { content: '', truncated: true } : { content: raw, truncated: false };
}

/** Top-level schema properties: `lightning:type` wins over JSON Schema `type`, then `$ref`. */
export function schemaProperties(schema: unknown): { title?: string; description?: string; properties: LightningTypeProperty[] } {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { properties: [] };
  const root = schema as Record<string, unknown>;
  const required = new Set(Array.isArray(root.required) ? root.required.filter((name): name is string => typeof name === 'string') : []);
  const props = root.properties && typeof root.properties === 'object' && !Array.isArray(root.properties) ? root.properties as Record<string, unknown> : {};
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : undefined;
  const properties = Object.entries(props).slice(0, LIGHTNING_TYPE_LIMITS.properties).map(([name, value]) => {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const type = text(row['lightning:type']) ?? (Array.isArray(row.type) ? row.type.filter(t => typeof t === 'string').join(' | ') || undefined : text(row.type)) ?? text(row.$ref);
    const title = text(row.title); const description = text(row.description);
    return { name, required: required.has(name), ...(type ? { type } : {}), ...(title ? { title } : {}), ...(description ? { description } : {}) };
  });
  const title = text(root.title); const description = text(root.description);
  return { ...(title ? { title } : {}), ...(description ? { description } : {}), properties };
}

/** schema.json first, then each channel folder's JSON (renderer, editor), all confined to the bundle. */
export function readLightningType(root: string, ref: string, deps: SalesforceDeps, index: ProjectActionIndex): LightningTypeView {
  const parsed = parseLightningTypeRef(ref);
  if (!parsed) throw Error('Not a Lightning Type reference.');
  if (parsed.standard) return { ref, standard: true, status: 'standard', properties: [], files: [], message: 'A standard Lightning Type defined by the Salesforce platform. It has no source in this project.' };
  const bundle = lightningTypeBundlePath(index, ref);
  if (!bundle) return {
    ref, standard: false, status: 'missing', properties: [], files: [],
    message: parsed.namespace && parsed.namespace !== index.namespace
      ? `This type comes from the ${parsed.namespace} package. Its source is not in this project.`
      : `No lightningTypes/${parsed.bundle} bundle in this project. Retrieve it with: sf project retrieve start -m LightningTypeBundle:${parsed.bundle}`
  };
  const dir = resolveUnderRoot(index.realRoot, join(index.realRoot, bundle), deps.realpath);
  if (!dir) throw Error('The Lightning Type bundle is outside this project.');
  const files: LightningTypeView['files'] = [];
  const add = (path: string) => {
    if (files.length >= LIGHTNING_TYPE_LIMITS.files) return;
    const confined = resolveUnderRoot(dir, path, deps.realpath);
    if (!confined || deps.stat(confined) !== 'file') return;
    const read = readBounded(deps, confined);
    if (read) files.push({ path: relative(index.realRoot, confined).split('\\').join('/'), content: read.content, ...(read.truncated ? { truncated: true } : {}) });
  };
  let children: string[] = [];
  try { children = deps.readdir(dir).sort(); } catch { /* an unreadable bundle still shows its path */ }
  if (children.includes('schema.json')) add(join(dir, 'schema.json'));
  for (const name of children) {
    if (name === 'schema.json' || name.startsWith('.')) continue;
    const child = join(dir, name);
    if (name.endsWith('.json')) { add(child); continue; }
    const confined = resolveUnderRoot(dir, child, deps.realpath);
    if (!confined || deps.stat(confined) !== 'dir') continue;
    let nested: string[] = [];
    try { nested = deps.readdir(confined).sort(); } catch { continue; }
    for (const file of nested) if (file.endsWith('.json')) add(join(confined, file));
  }
  const schemaFile = files.find(file => basename(file.path) === 'schema.json' && !file.truncated);
  let schema: ReturnType<typeof schemaProperties> = { properties: [] };
  let message: string | undefined;
  if (schemaFile) { try { schema = schemaProperties(JSON.parse(schemaFile.content)); } catch { message = 'schema.json is not valid JSON.'; } }
  else message = 'This bundle has no readable schema.json.';
  return { ref, standard: false, status: 'ready', path: bundle, ...schema, files, ...(message ? { message } : {}) };
}
