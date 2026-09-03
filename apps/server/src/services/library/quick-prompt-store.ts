import { app, shell } from 'electron';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  watch,
  type FSWatcher
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { QuickPrompt, LaunchProfileId, WorkflowArgument } from '@zana-ai/zcc-domain/product';
import { VALID_PROFILES } from '@zana-ai/zcc-domain/launch-provider';
import { electronZccDataDir } from '../../electron-data-dir.js';

/** Atomic write (tmp + rename) so a concurrent read never sees a half-written
 *  file — Rule 4. Mirrors prompt-registry.ts's helper. */
function writeFileAtomic(file: string, text: string) {
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** Filesystem-safe filename for a user prompt id (mirrors prompt-registry.ts). */
function fileNameForId(id: string): string {
  return `${id.replace(/[^a-zA-Z0-9._-]+/g, '_')}.json`;
}

/**
 * Sanitize a user-supplied `arguments` array into well-formed
 * {@link WorkflowArgument}s. Main authorizes what a file on disk claims (Rule 1):
 * a non-array, or an entry missing a string `name`, is dropped rather than
 * trusted. Returns `undefined` when nothing valid survives so the prompt stays a
 * plain flat prompt. Note the *template* is still the source of truth for which
 * args exist at fill time (see `resolveArguments`) — this only cleans metadata.
 */
function sanitizeArguments(raw: unknown): WorkflowArgument[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: WorkflowArgument[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Partial<WorkflowArgument>;
    if (typeof a.name !== 'string' || !a.name.trim() || seen.has(a.name)) continue;
    seen.add(a.name);
    const type = a.type === 'enum' ? 'enum' : 'text';
    const enumValues =
      type === 'enum' && Array.isArray(a.enumValues)
        ? a.enumValues.filter((v): v is string => typeof v === 'string')
        : undefined;
    out.push({
      name: a.name,
      type,
      ...(enumValues && enumValues.length ? { enumValues } : {}),
      ...(typeof a.description === 'string' ? { description: a.description } : {}),
      ...(typeof a.defaultValue === 'string' ? { defaultValue: a.defaultValue } : {})
    });
  }
  return out.length ? out : undefined;
}

const userDir = () => join(electronZccDataDir(), 'quick-prompts');

/**
 * Built-in starter prompts for the Agents-module Quick Agent launcher. Stable
 * IDs are prefixed with `builtin:` so a user can shadow one by dropping a file
 * with the same id in their own quick-prompts dir.
 *
 * The Quick Agent runs in the `~/zcc-workspace` scratch project, so prompts are
 * phrased for an agent that has a shell + the zcc-center MCP. The clone prompt
 * delegates placement and project registration to the host-owned clone tool.
 */
const BUILTIN: QuickPrompt[] = [
  {
    id: 'builtin:clone-repo',
    label: 'Clone a GitHub repo',
    icon: 'GitBranch',
    profile: 'claude',
    prompt: [
      'I want to bring a GitHub repository into my workspace.',
       'Ask me for the repo URL if I have not given it, then call the `clone_project`',
       'MCP tool (mcp__zcc-inbox__clone_project) with that URL. It clones into the',
       'configured clone root using the repository name and registers the result in',
       'my project list. Then confirm the project name and path back to me. Do not',
       'modify anything outside the clone.'
    ].join(' ')
  },
  {
    id: 'builtin:audit-projects',
    label: 'Audit my project list',
    icon: 'ListChecks',
    profile: 'claude',
    prompt: [
      'Review my Zana project list (read',
      '~/.zcc/data/projects.json, or use the `zcc projects ls` CLI if',
      'available). For each project, note whether its path still exists on disk',
      'and flag duplicates or stale entries. Output a short triaged list with a',
      'suggested action per row. Do not delete or modify anything.'
    ].join(' ')
  },
  {
    id: 'builtin:summarize-inbox',
    label: "Summarize today's inbox",
    icon: 'Inbox',
    profile: 'claude',
    prompt: [
      'Summarize the most recent entries in my Zana inbox',
      '(~/.zcc/inbox/entries.jsonl). Group them by project and classify each',
      'as action / fyi / noise with a one-line note. Keep it under 15 bullets.'
    ].join(' ')
  },
  {
    id: 'builtin:run-tests-for',
    label: 'Run tests for a package',
    icon: 'FlaskConical',
    profile: 'claude',
    prompt: [
      'Run the test suite for the {{package}} package and give me a short summary',
      'of any failures — the failing test name, the assertion, and a one-line',
      'hypothesis for each. Do not attempt fixes unless I ask; just triage.'
    ].join(' '),
    arguments: [
      {
        name: 'package',
        type: 'text',
        description: 'Package / workspace to test',
        defaultValue: ''
      }
    ]
  },
  {
    id: 'builtin:scratch-experiment',
    label: 'New scratch experiment',
    icon: 'FlaskConical',
    profile: 'claude-yolo',
    prompt: [
      'Set up a fresh scratch experiment in the current directory (already an',
      'isolated scratch session folder). Ask me what I want to prototype, scaffold',
      'a minimal project for it (language/runtime of my choice), and leave me a',
      'note on how to run it.'
    ].join(' ')
  }
];

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** README dropped into the user dir on first run so people know what goes there. */
function ensureReadme(dir: string) {
  const readme = join(dir, 'README.md');
  if (existsSync(readme)) return;
  try {
    writeFileSync(
      readme,
      [
        '# Quick prompts',
        '',
        'Drop one JSON file per prompt in this directory. Each file becomes a',
        'starter chip in the Agents-module Quick Agent launcher. Clicking a chip',
        'seeds the prompt into the launcher textarea — the user can still edit it',
        'before launching.',
        '',
        '## Schema',
        '',
        '```json',
        '{',
        '  "id": "my-prompt",',
        '  "label": "Short chip label",',
        '  "prompt": "Run tests for {{package}} and summarize failures.",',
        '  "profile": "claude",',
        '  "icon": "Sparkles",',
        '  "arguments": [',
        '    { "name": "package", "type": "text", "description": "npm package", "defaultValue": "core" }',
        '  ]',
        '}',
        '```',
        '',
        '`profile` is optional and must be one of `shell`, `claude`,',
        '`claude-resume`, `claude-yolo`. Files with invalid JSON or a missing',
        '`id`/`label`/`prompt` are silently skipped. A built-in prompt is shadowed',
        'when you drop a file with the same `id` here.',
        '',
        '## Arguments (optional)',
        '',
        'Put `{{name}}` placeholders in `prompt` to make it a fill-in-the-blanks',
        'workflow — clicking the chip opens a small form to fill each slot before',
        'the text is seeded. Use `{{{literal}}}` (triple braces) to render a real',
        '`{{literal}}` without treating it as a slot. Each `arguments` entry may',
        'set `type` (`"text"` or `"enum"`), `enumValues` (for `enum`),',
        '`description`, and `defaultValue`. Declaring `arguments` is optional — a',
        'placeholder with no declaration is just a free-text field.',
        ''
      ].join('\n')
    );
  } catch {
    // Best-effort scaffolding — never fail boot if the home dir is RO.
  }
}

function readPromptFile(path: string): QuickPrompt | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<QuickPrompt>;
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
    if (typeof raw.label !== 'string' || !raw.label.trim()) return null;
    if (typeof raw.prompt !== 'string' || !raw.prompt.trim()) return null;
    const profile =
      raw.profile && VALID_PROFILES.includes(raw.profile) ? raw.profile : undefined;
    return {
      id: raw.id,
      label: raw.label,
      prompt: raw.prompt,
      profile,
      icon: typeof raw.icon === 'string' ? raw.icon : undefined,
      arguments: sanitizeArguments((raw as { arguments?: unknown }).arguments)
    };
  } catch {
    return null;
  }
}

function listInDir(dir: string): QuickPrompt[] {
  if (!existsSync(dir)) return [];
  const out: QuickPrompt[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const p = readPromptFile(join(dir, name));
    if (p) {
      p.source = 'user';
      out.push(p);
    }
  }
  return out;
}

/**
 * Holds the union of built-ins + the user dir, with fs.watch-based invalidation
 * so dropping a file in the user dir lights up the launcher without a restart.
 * A user prompt with the same id as a builtin shadows the builtin. Mirrors
 * {@link TemplateStore} but with no per-project tier — quick prompts are global.
 */
export class QuickPromptStore extends EventEmitter {
  private cache: QuickPrompt[] = [];
  private userWatcher: FSWatcher | null = null;
  private debounce: NodeJS.Timeout | null = null;

  start() {
    const dir = userDir();
    ensureDir(dir);
    ensureReadme(dir);
    this.refresh();
    this.attachUserWatcher();
  }

  stop() {
    if (this.userWatcher) {
      this.userWatcher.close();
      this.userWatcher = null;
    }
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
  }

  list(): QuickPrompt[] {
    return this.cache;
  }

  /** Look up one entry by id (built-in or user-shadowed), or null. */
  get(id: string): QuickPrompt | null {
    return this.cache.find((p) => p.id === id) ?? null;
  }

  /** Re-discover all sources. Cheap; called on watch events. */
  refresh() {
    const merged = new Map<string, QuickPrompt>();
    for (const p of BUILTIN) merged.set(p.id, { ...p, source: 'builtin' });
    for (const p of listInDir(userDir())) merged.set(p.id, p);
    this.cache = [...merged.values()];
    this.emit('changed');
  }

  /**
   * Persist a user quick-prompt (shadows a builtin when the id matches). Main
   * authorizes the write (Rule 1): id/label/prompt are required non-empty
   * strings, the profile must be a known launch profile, and `arguments` is
   * sanitized exactly as the disk-load path does — so the editor can't store a
   * malformed entry that would only be dropped on the next read. Writes the
   * JSON atomically (Rule 4); the watcher refreshes, but we refresh
   * synchronously too so callers see it immediately. Throws on invalid input so
   * the IPC rejects and the editor shows the error. Returns the stored entry.
   */
  saveUser(entry: QuickPrompt): QuickPrompt {
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    const prompt = typeof entry.prompt === 'string' ? entry.prompt : '';
    if (!id) throw new Error('quick prompt id is required');
    if (!label) throw new Error('quick prompt label is required');
    if (!prompt.trim()) throw new Error('quick prompt text is required');
    if (entry.profile && !VALID_PROFILES.includes(entry.profile)) {
      throw new Error(`invalid profile "${entry.profile}"`);
    }
    const clean: QuickPrompt = {
      id,
      label,
      prompt,
      ...(entry.profile ? { profile: entry.profile } : {}),
      ...(typeof entry.icon === 'string' && entry.icon ? { icon: entry.icon } : {}),
      ...((): { arguments?: WorkflowArgument[] } => {
        const args = sanitizeArguments(entry.arguments);
        return args ? { arguments: args } : {};
      })()
    };
    const dir = userDir();
    ensureDir(dir);
    writeFileAtomic(join(dir, fileNameForId(id)), JSON.stringify(clean, null, 2));
    this.refresh();
    return { ...clean, source: 'user' };
  }

  /**
   * Delete the user file for an id. For a shadowed built-in this "resets" it to
   * the shipped default; for a purely-user prompt it removes it. No-op if no
   * user file exists. Mirrors prompt-registry.ts's deleteUser.
   */
  deleteUser(id: string): void {
    const file = join(userDir(), fileNameForId(id));
    try {
      if (existsSync(file)) rmSync(file);
    } catch {
      /* best-effort */
    }
    this.refresh();
  }

  async revealUserDir(): Promise<{ ok: boolean; path: string; message?: string }> {
    const path = userDir();
    try {
      ensureDir(path);
      ensureReadme(path);
      await shell.openPath(path);
      return { ok: true, path };
    } catch (err) {
      return {
        ok: false,
        path,
        message: err instanceof Error ? err.message : String(err)
      };
    }
  }

  // ----- internals -----------------------------------------------------------

  private attachUserWatcher() {
    const dir = userDir();
    try {
      const w = watch(dir, { persistent: false }, () => this.scheduleRefresh());
      // fs.watch errors propagate to 'uncaughtException' when the watched dir
      // vanishes (e.g. user `rm -rf`'d it). Catch, close the dead watcher, and
      // re-attach with backoff so live updates resume once the dir reappears.
      w.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error('[quick-prompt-store] user watcher error:', err);
        try {
          w.close();
        } catch {
          /* already closed */
        }
        if (this.userWatcher === w) this.userWatcher = null;
        setTimeout(() => {
          if (!this.userWatcher) {
            ensureDir(userDir());
            this.attachUserWatcher();
            this.scheduleRefresh();
          }
        }, 2_000);
      });
      this.userWatcher = w;
    } catch {
      // watcher unsupported on this fs — fall back to refresh-on-demand.
    }
  }

  /** Coalesce burst events (editor save = create+rename+modify on most fs). */
  private scheduleRefresh() {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.refresh();
    }, 150);
  }
}
