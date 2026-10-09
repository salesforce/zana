/** Turns the guardrail's JSON preview into reviewable rows; null means show the raw text. */
import { splitElided } from '../../lib/preview-json.js';

export type GuardrailField =
  | { key: string; label: string; kind: 'text'; value: string }
  | { key: string; label: string; kind: 'list'; value: string[]; more: number }
  | { key: string; label: string; kind: 'components'; value: GuardrailComponent[]; more: number };

export interface GuardrailComponent {
  type: string;
  name: string;
  path: string;
}

export interface GuardrailPreview {
  fields: GuardrailField[];
  /** Shown prominently, e.g. a retrieve overwriting local files. */
  warning?: string;
  raw: string;
}

const RETRIEVE_WARNING = 'Org metadata will overwrite matching local files. Commit or back up local changes before approving.';

const LABELS: Record<string, string> = {
  action: 'Action',
  verb: 'Action',
  target_org: 'Target org',
  api_version: 'API version',
  test_level: 'Test level',
  tests: 'Tests',
  source_paths: 'Components',
  source_dirs: 'Components',
  components: 'Components',
  metadata: 'Components'
};

const ORDER = ['action', 'verb', 'target_org', 'test_level', 'tests', 'api_version'];

const METADATA_TYPES: Record<string, string> = {
  aiAuthoringBundles: 'AI Authoring Bundle',
  applications: 'Custom App',
  aura: 'Aura Component',
  bots: 'Bot',
  classes: 'Apex Class',
  customMetadata: 'Custom Metadata',
  flexipages: 'Lightning Page',
  flows: 'Flow',
  genAiFunctions: 'Agent Action',
  genAiPlannerBundles: 'Agent Planner',
  genAiPlugins: 'Agent Topic',
  genAiPromptTemplates: 'Prompt Template',
  labels: 'Custom Labels',
  layouts: 'Page Layout',
  lightningTypes: 'Lightning Type',
  lwc: 'Lightning Web Component',
  objects: 'Custom Object',
  pages: 'Visualforce Page',
  permissionsets: 'Permission Set',
  profiles: 'Profile',
  staticresources: 'Static Resource',
  tabs: 'Custom Tab',
  triggers: 'Apex Trigger'
};

const OBJECT_CHILDREN: Record<string, string> = {
  fields: 'Custom Field',
  listViews: 'List View',
  recordTypes: 'Record Type',
  validationRules: 'Validation Rule'
};

const PACKAGE_RELATIVE = /(?:^|\/)([^/]+\/main\/default\/.*)$/;
const METADATA_MEMBER = /^([A-Z][A-Za-z0-9]*):(\S+)$/;

export function parseGuardrailPreview(preview: string): GuardrailPreview | null {
  let value: unknown;
  try {
    value = JSON.parse(preview);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record).filter(([key]) => key !== 'warning').sort(([a], [b]) => rank(a) - rank(b));
  const fields = entries.flatMap(([key, item]) => toField(key, item));
  const action = String(record.action ?? record.verb ?? '');
  const warning =
    typeof record.warning === 'string' && record.warning
      ? record.warning
      : /retrieve/.test(action) && !/preview/.test(action)
        ? RETRIEVE_WARNING
        : undefined;
  return { fields, ...(warning ? { warning } : {}), raw: JSON.stringify(value, null, 2) };
}

/** Maps `.../force-app/main/default/<folder>/<name>...` to its metadata type and API name. */
export function describeSourcePath(path: string): GuardrailComponent {
  const relative = projectRelative(path);
  const parts = relative.split('/');
  const at = parts.lastIndexOf('default');
  const folder = at >= 0 ? parts[at + 1] : undefined;
  const rest = at >= 0 ? parts.slice(at + 2) : [];
  if (!folder || rest.length === 0) return { type: folder ? (METADATA_TYPES[folder] ?? folder) : 'Directory', name: relative, path: relative };
  if (folder === 'objects' && rest.length >= 3 && OBJECT_CHILDREN[rest[1]!]) {
    return { type: OBJECT_CHILDREN[rest[1]!]!, name: `${rest[0]}.${apiName(rest[2]!)}`, path: relative };
  }
  return { type: METADATA_TYPES[folder] ?? folder, name: apiName(rest[0]!), path: relative };
}

function toField(key: string, value: unknown): GuardrailField[] {
  if (value === null || value === undefined || value === '') return [];
  const label = LABELS[key] ?? humanize(key);
  if (Array.isArray(value)) {
    const { items, more } = splitElided(value.map(item => (typeof item === 'string' ? item : JSON.stringify(item))));
    if (items.length === 0) return [];
    if (items.every(isSourcePath)) return [{ key, label, kind: 'components', value: items.map(describeSourcePath), more }];
    if (items.every(item => METADATA_MEMBER.test(item))) return [{ key, label, kind: 'components', value: items.map(describeMember), more }];
    return [{ key, label, kind: 'list', value: items, more }];
  }
  if (typeof value === 'object') return [{ key, label, kind: 'text', value: JSON.stringify(value) }];
  return [{ key, label, kind: 'text', value: String(value) }];
}

/** `ApexClass:OrderService` as passed to `sf project deploy --metadata`. */
function describeMember(member: string): GuardrailComponent {
  const [, type = '', name = member] = member.match(METADATA_MEMBER) ?? [];
  return { type: humanize(type).replace(/\b\w/g, letter => letter.toUpperCase()), name, path: member };
}

function isSourcePath(item: string): boolean {
  return item.includes('/main/default/') || item.startsWith('/');
}

function projectRelative(path: string): string {
  const match = path.match(PACKAGE_RELATIVE);
  return (match?.[1] ?? path).replace(/\/$/, '');
}

function apiName(file: string): string {
  return file.split('.')[0] ?? file;
}

function rank(key: string): number {
  const index = ORDER.indexOf(key);
  return index < 0 ? ORDER.length : index;
}

function humanize(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
