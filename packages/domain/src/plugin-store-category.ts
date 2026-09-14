export const PLUGIN_STORE_CATEGORY_NAMES = [
  'Workflow management',
  'Agent interaction',
  'Context & knowledge',
  'Developer tools',
  'Host access',
  'Interface'
] as const;

export type PluginStoreCategoryName = (typeof PLUGIN_STORE_CATEGORY_NAMES)[number];

export const PLUGIN_STORE_CATEGORIES: readonly {
  name: PluginStoreCategoryName;
  description: string;
}[] = [
  {
    name: 'Workflow management',
    description: 'Boards, automations, and structured work.'
  },
  {
    name: 'Agent interaction',
    description: 'Providers, harnesses, and how agents talk to you.'
  },
  {
    name: 'Context & knowledge',
    description: 'Memory, docs, and standing instructions.'
  },
  {
    name: 'Developer tools',
    description: 'Source control, reviews, and plugin authoring.'
  },
  {
    name: 'Host access',
    description: 'Machines, secrets, and the local environment.'
  },
  {
    name: 'Interface',
    description: 'Editors, previews, and in-app chrome.'
  }
];

const CATEGORY_SET = new Set<string>(PLUGIN_STORE_CATEGORY_NAMES);

export function resolvePluginStoreCategory(
  ...candidates: Array<string | undefined | null>
): PluginStoreCategoryName | undefined {
  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : '';
    if (value && CATEGORY_SET.has(value)) return value as PluginStoreCategoryName;
  }
  return undefined;
}

export function categoryFromMarketplaceFields(fields: {
  category?: string;
  tags?: readonly string[];
  extra?: Record<string, unknown>;
}): PluginStoreCategoryName | undefined {
  const extra = fields.extra?.category;
  return resolvePluginStoreCategory(
    fields.category,
    typeof extra === 'string' ? extra : undefined,
    ...(fields.tags ?? [])
  );
}
