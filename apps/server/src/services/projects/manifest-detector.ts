/**
 * ManifestDetector — load & parse herdr TOML agent-detection manifests.
 *
 * Loads manifests from:
 *  - Bundled: `manifests/` (repo root in dev, resources in packaged)
 *  - User: `~/.zcc/manifests/` (user overrides)
 *
 * User manifests with the same `id` FULLY REPLACE bundled ones.
 * Watches both dirs for changes, debounces reloads, emits 'changed' event.
 *
 * DO NOT implement matching/classification logic here — this module only
 * PARSES and STORES raw rule fields for later use.
 */

import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { isWithin } from '@zana-ai/zcc-path-confine';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * A single rule from a manifest [[rules]] table.
 * Stores raw matcher fields; evaluation logic lives elsewhere.
 */
export interface ManifestRule {
  id: string;
  state: string;
  priority: number;
  region: string;
  visible_working?: boolean;
  visible_blocker?: boolean;
  visible_idle?: boolean;
  // Matcher fields (raw, not evaluated here)
  contains?: string[];
  any?: unknown[];
  all?: unknown[];
  not?: unknown[];
  regex?: string[];
  line_regex?: string[];
  skip_state_update?: boolean;
}

/**
 * Top-level manifest structure.
 */
export interface AgentManifest {
  id: string;
  version?: string;
  min_engine_version?: number;
  updated_at?: string;
  aliases?: string[];
  rules: ManifestRule[];
}

export interface ManifestDetectorOptions {
  bundledDir?: string;
  userDir?: string;
}

/**
 * ManifestDetector class — loads & parses herdr-format TOML manifests.
 * Exposes listRules(agentType) and reload().
 */
export class ManifestDetector extends EventEmitter {
  private bundledDir: string;
  private userDir: string;
  private manifests: Map<string, AgentManifest> = new Map();
  private watchers: FSWatcher[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(opts: ManifestDetectorOptions = {}) {
    super();
    
    // Resolve directories only when not provided
    if (opts.bundledDir) {
      this.bundledDir = opts.bundledDir;
    } else {
      // Bundled manifests: resources/manifests in packaged, repo manifests/ in dev
      this.bundledDir = process.resourcesPath 
        ? join(process.resourcesPath, 'manifests')
        : join(__dirname, '../../manifests');
    }
    
    if (opts.userDir) {
      this.userDir = opts.userDir;
    } else {
      // User manifests: ~/.zcc/manifests (only resolve when not overridden).
      // Use homedir() rather than electron's app.getPath so this main-process
      // module stays unit-testable and matches env.ts / extension-installer.ts.
      this.userDir = join(homedir(), '.zcc', 'manifests');
    }
  }

  /**
   * Start watching directories and load manifests.
   */
  start(): void {
    this.reload();
    this.attachWatchers();
  }

  /**
   * Stop watching directories and clear state.
   */
  stop(): void {
    this.clearWatchers();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Reload manifests from both directories.
   */
  reload(): void {
    const newManifests = new Map<string, AgentManifest>();

    // Load bundled manifests first
    this.loadFromDir(this.bundledDir, newManifests);

    // Load user manifests (overrides bundled)
    this.loadFromDir(this.userDir, newManifests);

    this.manifests = newManifests;
    this.emit('changed');
  }

  /**
   * List rules for a given agent type (by id or alias), sorted by priority descending.
   * Returns [] for unknown agents.
   */
  listRules(agentType: string): ManifestRule[] {
    // Find manifest by id or alias
    let manifest = this.manifests.get(agentType);
    
    if (!manifest) {
      // Check aliases
      for (const m of this.manifests.values()) {
        if (m.aliases?.includes(agentType)) {
          manifest = m;
          break;
        }
      }
    }

    if (!manifest) {
      return [];
    }

    // Return rules sorted by priority descending (highest first)
    return [...manifest.rules].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Load manifests from a directory.
   */
  private loadFromDir(dir: string, target: Map<string, AgentManifest>): void {
    if (!existsSync(dir)) {
      return;
    }

    let files: string[];
    try {
      files = readdirSync(dir);
    } catch (err) {
      console.error('[manifest-detector] Failed to read directory:', dir, err);
      return;
    }

    // Confine every entry to the directory root before reading it. readdirSync
    // yields only direct children, but a hostile filename/symlink must never let
    // a read escape the trusted root (renderer is untrusted; main authorizes).
    const root = resolve(dir);
    for (const file of files) {
      if (!file.endsWith('.toml')) {
        continue;
      }

      const path = resolve(root, file);
      if (!isWithin(path, root)) {
        console.warn('[manifest-detector] Skipped manifest outside root:', file);
        continue;
      }
      const manifest = this.loadManifest(path);

      if (manifest) {
        // Use manifest id, or fall back to filename without .toml
        const id = manifest.id || file.replace(/\.toml$/, '');
        target.set(id, manifest);
      }
    }
  }

  /**
   * Load and parse a single manifest file.
   * Returns null on failure (logs warning but never throws).
   */
  private loadManifest(path: string): AgentManifest | null {
    try {
      const content = readFileSync(path, 'utf-8');
      const parsed = parse(content) as Record<string, unknown>;

      // Extract top-level fields
      const id = typeof parsed.id === 'string' ? parsed.id : '';
      const version = typeof parsed.version === 'string' ? parsed.version : undefined;
      const min_engine_version = typeof parsed.min_engine_version === 'number' ? parsed.min_engine_version : undefined;
      const updated_at = typeof parsed.updated_at === 'string' ? parsed.updated_at : undefined;
      const aliases = Array.isArray(parsed.aliases) 
        ? parsed.aliases.filter((a): a is string => typeof a === 'string')
        : undefined;

      // Parse rules
      const rules: ManifestRule[] = [];
      if (Array.isArray(parsed.rules)) {
        for (const r of parsed.rules) {
          if (typeof r !== 'object' || r === null) {
            continue;
          }
          
          const rule = r as Record<string, unknown>;
          
          // Required fields
          if (typeof rule.id !== 'string' || typeof rule.state !== 'string' || 
              typeof rule.priority !== 'number' || typeof rule.region !== 'string') {
            continue;
          }

          const manifestRule: ManifestRule = {
            id: rule.id,
            state: rule.state,
            priority: rule.priority,
            region: rule.region,
          };

          // Optional visibility flags
          if (typeof rule.visible_working === 'boolean') {
            manifestRule.visible_working = rule.visible_working;
          }
          if (typeof rule.visible_blocker === 'boolean') {
            manifestRule.visible_blocker = rule.visible_blocker;
          }
          if (typeof rule.visible_idle === 'boolean') {
            manifestRule.visible_idle = rule.visible_idle;
          }
          if (typeof rule.skip_state_update === 'boolean') {
            manifestRule.skip_state_update = rule.skip_state_update;
          }

          // Matcher fields (store raw, don't evaluate)
          if (Array.isArray(rule.contains)) {
            manifestRule.contains = rule.contains.filter((s): s is string => typeof s === 'string');
          }
          if (Array.isArray(rule.regex)) {
            manifestRule.regex = rule.regex.filter((s): s is string => typeof s === 'string');
          }
          if (Array.isArray(rule.line_regex)) {
            manifestRule.line_regex = rule.line_regex.filter((s): s is string => typeof s === 'string');
          }
          if (Array.isArray(rule.any)) {
            manifestRule.any = rule.any;
          }
          if (Array.isArray(rule.all)) {
            manifestRule.all = rule.all;
          }
          if (Array.isArray(rule.not)) {
            manifestRule.not = rule.not;
          }

          rules.push(manifestRule);
        }
      }

      return {
        id,
        version,
        min_engine_version,
        updated_at,
        aliases,
        rules,
      };
    } catch (err) {
      console.warn('[manifest-detector] Failed to parse manifest:', path, err);
      return null;
    }
  }

  /**
   * Attach file watchers to both directories.
   */
  private attachWatchers(): void {
    this.clearWatchers();

    for (const dir of [this.bundledDir, this.userDir]) {
      if (!existsSync(dir)) {
        continue;
      }

      try {
        const watcher = watch(dir, { persistent: false }, () => {
          this.scheduleReload();
        });

        watcher.on('error', (err) => {
          console.error('[manifest-detector] Watcher error for', dir, err);
          // Try to reattach after error
          setTimeout(() => {
            const idx = this.watchers.indexOf(watcher);
            if (idx >= 0) {
              this.watchers.splice(idx, 1);
            }
            try {
              watcher.close();
            } catch {
              // ignore
            }
          }, 2000);
        });

        this.watchers.push(watcher);
      } catch (err) {
        console.error('[manifest-detector] Failed to watch directory:', dir, err);
      }
    }
  }

  /**
   * Clear all watchers.
   */
  private clearWatchers(): void {
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
    }
    this.watchers = [];
  }

  /**
   * Debounced reload scheduler.
   */
  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.reload();
    }, 500);
  }
}
