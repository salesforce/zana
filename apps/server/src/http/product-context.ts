import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AppConfig, Project } from '@zana-ai/zcc-domain/product';
import { openDatabase, type ZccDatabase } from '@zana-ai/zcc-db';
import { createProjectStore, type ProjectStore } from '../project-store.js';
import { createConfigStore } from '../services/config/config-store.js';
import { createInboxStore, type IInboxStore } from '../services/inbox/inbox-store.js';
import { createSuggestionsStore, type ISuggestionsStore } from '../services/suggestions/suggestions-store.js';
import { createSavedStore, type ISavedStore } from '../services/saved/saved-store.js';
import type { LocalAppOriginArgs } from './local-app-origins.js';
import { createProductHub, type ProductHub } from './product-hub.js';
import { createHostHub, type HostHub } from './host-hub.js';

export interface ProductHttpContext {
  origins: LocalAppOriginArgs;
  dataDir: string;
  enrollToken: string;
  db: ZccDatabase;
  hostHub: HostHub;
  projects: ProjectStore;
  config: ReturnType<typeof createConfigStore>;
  inbox: IInboxStore;
  suggestions: ISuggestionsStore;
  saved: ISavedStore;
  hub: ProductHub;
  toProjects(): Project[];
}

export interface CreateProductHttpContextOptions {
  dataDir?: string;
  origins: LocalAppOriginArgs;
  enrollToken?: string;
  /** Reuse a process-local project store when one already exists. */
  projects?: ProjectStore;
}

const identityConfig = {
  normalizeConfig: (input: Partial<AppConfig>) => input,
  projectConfigCompatibility: (input: AppConfig) => input,
  canonicalConfigForWrite: (input: AppConfig) => input,
  harnessEnabled: (_input: AppConfig, id: NonNullable<AppConfig['defaultHarness']>) => id === 'claude'
};

export function createProductHttpContext(
  options: CreateProductHttpContextOptions
): ProductHttpContext {
  const dataDir = options.dataDir ?? join(homedir(), '.zcc');
  const projects = options.projects ?? createProjectStore({
    projectsFile: join(dataDir, 'projects.json'),
    remotePlaceholderRoot: join(dataDir, 'remote-projects')
  });
  const config = createConfigStore(
    { homeDir: join(dataDir, '..'), configFile: join(dataDir, 'config.json') },
    identityConfig
  );
  const inbox = createInboxStore({ filePath: join(dataDir, 'inbox', 'entries.jsonl') });
  const suggestions = createSuggestionsStore({
    filePath: join(dataDir, 'suggestions', 'entries.jsonl')
  });
  const saved = createSavedStore({ dir: join(dataDir, 'saved') });
  const hub = createProductHub();
  const db = openDatabase(join(dataDir, 'zcc.sqlite'));
  const hostHub = createHostHub(db, hub);
  const enrollToken = options.enrollToken
    ?? process.env.ZCC_HOST_ENROLL_TOKEN
    ?? randomBytes(32).toString('hex');

  inbox.onAppended((entry) => hub.emit('inbox:appended', entry));
  inbox.onRemoved((id) => hub.emit('inbox:removed', id));
  inbox.onUpdated((entry) => hub.emit('inbox:updated', entry));
  inbox.onPruned((ids) => hub.emit('inbox:pruned', ids));
  suggestions.onAppended((entry) => hub.emit('suggestions:appended', entry));
  suggestions.onRemoved((id) => hub.emit('suggestions:removed', id));
  suggestions.onUpdated((entry) => hub.emit('suggestions:updated', entry));
  suggestions.onPruned((ids) => hub.emit('suggestions:pruned', ids));
  saved.onChanged((records) => hub.emit('saved:changed', records));

  return {
    origins: options.origins,
    dataDir,
    enrollToken,
    db,
    hostHub,
    projects,
    config,
    inbox,
    suggestions,
    saved,
    hub,
    toProjects: () => projects.list() as unknown as Project[]
  };
}
