import { app, shell } from 'electron';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  watch,
  type FSWatcher
} from 'node:fs';
import { join } from 'node:path';
import type { Project, ScheduleTemplate, LaunchProfileId } from '../shared/types.js';
import { VALID_PROFILES } from '../shared/launch-provider.js';

const userTemplatesDir = () => join(app.getPath('home'), '.zcc', 'templates');
const projectTemplatesDir = (project: Project) =>
  join(project.path, '.zcc', 'templates');

/**
 * Built-in catalogue. Stable IDs are prefixed with `builtin:` so a user can
 * disable / shadow them by dropping a file with the same id stem in their
 * own templates dir.
 */
const BUILTIN: ScheduleTemplate[] = [
  {
    id: 'builtin:qa-agent',
    name: 'QA Agent',
    description:
      'Hourly health check: runs tests, surfaces type errors, flags regressions.',
    category: 'QA',
    icon: 'ShieldCheck',
    defaults: {
      profile: 'claude-yolo',
      every: '1h',
      name: 'QA Agent',
      prompt: [
        'Run the project test suite and the type-checker.',
        'If anything fails, summarize the failure and the suspected root cause.',
        'If everything passes, reply with a one-line "all green" status.'
      ].join(' ')
    }
  },
  {
    id: 'builtin:standup-digest',
    name: 'Morning standup digest',
    description: 'Once a day, summarize what changed in the repo since yesterday.',
    category: 'Reports',
    icon: 'Sun',
    defaults: {
      profile: 'claude',
      every: '24h',
      name: 'Morning standup digest',
      prompt:
        'Summarize what changed in this repo over the last 24 hours: commits, open PRs, and notable failing checks. Keep it under 10 bullets.'
    }
  },
  {
    id: 'builtin:dependency-audit',
    name: 'Dependency audit',
    description: 'Weekly check for outdated or vulnerable dependencies.',
    category: 'Maintenance',
    icon: 'Package',
    defaults: {
      profile: 'claude-yolo',
      every: '24h',
      name: 'Dependency audit',
      prompt:
        'Audit dependencies for known vulnerabilities and major-version drift. List concrete upgrade candidates with risk notes; do not modify any files.'
    }
  },
  {
    id: 'builtin:repo-health',
    name: 'Repo health check',
    description: 'Looks for stale branches, large files, and broken docs.',
    category: 'Maintenance',
    icon: 'Activity',
    defaults: {
      profile: 'claude',
      every: '6h',
      name: 'Repo health check',
      prompt:
        'Inspect repo health: stale branches, oversized files in the working tree, broken README/docs links. Output a short triaged list.'
    }
  },
  {
    id: 'builtin:inbox-watcher',
    name: 'Inbox watcher',
    description: 'Periodically checks the project inbox for new entries to triage.',
    category: 'Triage',
    icon: 'Inbox',
    defaults: {
      profile: 'claude',
      every: '30m',
      name: 'Inbox watcher',
      prompt:
        'Check the inbox for unread entries. For each, draft a one-line classification (action / fyi / noise) and an optional next step.'
    }
  },
  {
    id: 'builtin:slack-mention-triage',
    name: 'Slack mention triage',
    description:
      'Scans Slack for recent messages mentioning you, pre-analyses them, and pushes a triaged summary to the inbox.',
    category: 'Slack',
    icon: 'Inbox',
    defaults: {
      profile: 'claude-yolo',
      every: '30m',
      name: 'Slack mention triage',
      prompt: [
        'You are a Slack triage assistant. Use the Slack MCP tools',
        '(`mcp__slack__*`) to do the following, in this order:',
        '',
        '1. Discover *your own* Slack identity (e.g. via `slack_search_users`',
        '   on yourself, or whichever tool the Slack MCP exposes for "me").',
        '   Cache the user id locally for this run; do NOT ask the user.',
        '',
        '2. Search the last 30 minutes for items that need my attention:',
        '   - direct mentions (@me) in any channel,',
        '   - DMs sent to me,',
        '   - replies on threads where I posted earlier today.',
        '   Use Slack search MCP tools — do not page through every channel.',
        '',
        '3. For each item, decide a classification:',
        '   - `action` — needs a reply or a decision from me,',
        '   - `fyi`    — informational, no action,',
        '   - `noise`  — bot spam, channel chatter, ignore.',
        '   Write one short sentence of pre-analysis (what is it about,',
        '   and if `action`, what would a reasonable response look like).',
        '',
        '4. If there is at least one `action` or `fyi` item, call',
        '   `mcp__zcc-inbox__inbox_push` ONCE with `comments` set to a',
        '   markdown digest grouped by classification, with a permalink',
        '   to each Slack message. If there are zero non-`noise` items,',
        '   exit silently — do NOT push an empty inbox entry.',
        '',
        '5. Do not reply on Slack. Do not modify any files. Read-only run.'
      ].join(' ')
    }
  },
  {
    id: 'builtin:slack-agent-runner',
    name: 'Slack [agent] runner',
    description:
      'Finds messages you wrote starting with [agent], runs the instructions, and replies in the same Slack thread.',
    category: 'Slack',
    icon: 'Sparkles',
    defaults: {
      profile: 'claude-yolo',
      every: '15m',
      name: 'Slack [agent] runner',
      prompt: [
        'You are a Slack-driven action runner. Use the Slack MCP tools',
        '(`mcp__slack__*`) and any other tools available in this session',
        '(read files, run commands, etc.) as needed. Steps:',
        '',
        '1. Discover *your own* Slack identity. Cache the user id; do NOT',
        '   ask the user.',
        '',
        '2. Search Slack for messages authored by that identity in the',
        '   last 30 minutes whose text contains the literal token',
        '   `[agent]` (case-insensitive). Skip messages where you have',
        '   already posted a threaded reply (check the thread before',
        '   acting — the reply is the idempotency marker).',
        '',
        '3. For each unhandled message:',
        '   a. Parse the instruction: everything after `[agent]` up to',
        '      the end of the message body.',
        '   b. Carry out the instruction in the context of the *current*',
        '      project (this terminal\'s cwd). You may read files, run',
        '      git/test/build commands, and call other MCPs.',
        '   c. Post a single threaded reply on the original Slack',
        '      message with the result. Keep it under ~30 lines; if the',
        '      output is longer, summarise and link to a gist or attach',
        '      the body as a code block.',
        '',
        '4. After all `[agent]` messages are handled, call',
        '   `mcp__zcc-inbox__inbox_push` ONCE with `comments` set to a',
        '   short markdown audit log: one bullet per message handled,',
        '   each with the Slack permalink and the first line of your',
        '   reply. If you handled zero messages, exit silently.',
        '',
        '5. If an instruction is destructive or ambiguous, do NOT guess —',
        '   reply on the thread asking for clarification, and note the',
        '   skip in the inbox audit.'
      ].join(' ')
    }
  }
];

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** README dropped into the user dir on first run so people know what goes there. */
function ensureReadme(dir: string) {
  const readme = join(dir, 'README.md');
  if (existsSync(readme)) return;
  const sample = join(dir, 'example.json.disabled');
  try {
    writeFileSync(
      readme,
      [
        '# Schedule templates',
        '',
        'Drop one JSON file per template in this directory. Each file becomes a',
        'reusable preset in the Scheduler\'s "From template" picker. Templates',
        'do not run on their own — the user picks one, optionally tweaks it,',
        'and creates a normal schedule from it.',
        '',
        '## Schema',
        '',
        '```json',
        '{',
        '  "id": "my-template",',
        '  "name": "My template",',
        '  "description": "What it does (optional)",',
        '  "category": "QA",',
        '  "icon": "ShieldCheck",',
        '  "defaults": {',
        '    "profile": "claude",',
        '    "every": "1h",',
        '    "prompt": "Optional initial prompt typed into the terminal."',
        '  }',
        '}',
        '```',
        '',
        '`profile` must be one of `shell`, `claude`, `claude-resume`, `claude-yolo`.',
        'Files with invalid JSON or missing required fields are silently skipped.',
        'A built-in template is shadowed when you drop a file with the same `id` here.',
        ''
      ].join('\n')
    );
    if (!existsSync(sample)) {
      const example = BUILTIN[0];
      writeFileSync(
        sample,
        JSON.stringify(
          {
            id: 'my-template',
            name: example.name,
            description: example.description,
            category: example.category,
            icon: example.icon,
            defaults: example.defaults
          },
          null,
          2
        )
      );
    }
  } catch {
    // Best-effort scaffolding — never fail boot if the home dir is RO.
  }
}

function readTemplateFile(path: string): ScheduleTemplate | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ScheduleTemplate>;
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
    if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
    if (!raw.defaults || typeof raw.defaults !== 'object') return null;
    const profile = raw.defaults.profile;
    if (!profile || !VALID_PROFILES.includes(profile)) return null;
    if (typeof raw.defaults.every !== 'string' || !raw.defaults.every.trim()) return null;
    return {
      id: raw.id,
      name: raw.name,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      category: typeof raw.category === 'string' ? raw.category : undefined,
      icon: typeof raw.icon === 'string' ? raw.icon : undefined,
      defaults: {
        profile: raw.defaults.profile,
        every: raw.defaults.every,
        prompt:
          typeof raw.defaults.prompt === 'string' ? raw.defaults.prompt : undefined,
        extraArgs: Array.isArray(raw.defaults.extraArgs)
          ? raw.defaults.extraArgs.filter((s) => typeof s === 'string')
          : undefined,
        name: typeof raw.defaults.name === 'string' ? raw.defaults.name : undefined,
        description:
          typeof raw.defaults.description === 'string'
            ? raw.defaults.description
            : undefined
      }
    };
  } catch {
    return null;
  }
}

function listInDir(
  dir: string,
  source: ScheduleTemplate['source']
): ScheduleTemplate[] {
  if (!existsSync(dir)) return [];
  const out: ScheduleTemplate[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const t = readTemplateFile(join(dir, name));
    if (t) {
      t.source = source;
      out.push(t);
    }
  }
  return out;
}

/**
 * Holds the union of built-ins + user dir + per-project dirs, with simple
 * fs.watch-based invalidation so dropping a file in the user dir lights up
 * the picker without an app restart.
 *
 * Resolution order: project > user > builtin. A user template with the
 * same id as a builtin shadows the builtin.
 */
export class TemplateStore extends EventEmitter {
  private cache: ScheduleTemplate[] = [];
  private projectsRef: () => Project[];
  private userWatcher: FSWatcher | null = null;
  private projectWatchers: Map<string, FSWatcher> = new Map();
  private debounce: NodeJS.Timeout | null = null;

  constructor(projectsRef: () => Project[]) {
    super();
    this.projectsRef = projectsRef;
  }

  start() {
    const dir = userTemplatesDir();
    ensureDir(dir);
    ensureReadme(dir);
    this.refresh();
    this.attachUserWatcher();
    this.attachProjectWatchers();
  }

  stop() {
    if (this.userWatcher) {
      this.userWatcher.close();
      this.userWatcher = null;
    }
    for (const w of this.projectWatchers.values()) w.close();
    this.projectWatchers.clear();
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
  }

  list(): ScheduleTemplate[] {
    return this.cache;
  }

  /** Re-discover all sources. Cheap; called on watch events and on project changes. */
  refresh() {
    const merged = new Map<string, ScheduleTemplate>();
    for (const t of BUILTIN) merged.set(t.id, { ...t, source: 'builtin' });
    for (const t of listInDir(userTemplatesDir(), 'user')) merged.set(t.id, t);
    for (const project of this.projectsRef()) {
      const projectSource: ScheduleTemplate['source'] = {
        projectId: project.id,
        projectName: project.name
      };
      for (const t of listInDir(projectTemplatesDir(project), projectSource)) {
        merged.set(t.id, t);
      }
    }
    this.cache = [...merged.values()];
    this.emit('changed');
  }

  /** Hook for `store.addProject` / `store.removeProject`. */
  rebindProjects() {
    for (const w of this.projectWatchers.values()) w.close();
    this.projectWatchers.clear();
    this.attachProjectWatchers();
    this.refresh();
  }

  /** Path of the user templates dir (for "Open in Finder"). */
  userDir(): string {
    return userTemplatesDir();
  }

  async revealUserDir(): Promise<{ ok: boolean; path: string; message?: string }> {
    const path = userTemplatesDir();
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
    const dir = userTemplatesDir();
    try {
      const w = watch(dir, { persistent: false }, () => this.scheduleRefresh());
      // fs.watch errors propagate to 'uncaughtException' on Linux/macOS when
      // the watched dir vanishes (e.g. user `rm -rf`'d it). Catch them here,
      // close the dead watcher, and re-attach with backoff so live updates
      // resume once the dir reappears.
      w.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error('[template-store] user watcher error:', err);
        try {
          w.close();
        } catch {
          /* already closed */
        }
        if (this.userWatcher === w) this.userWatcher = null;
        setTimeout(() => {
          if (!this.userWatcher) {
            ensureDir(userTemplatesDir());
            this.attachUserWatcher();
            this.scheduleRefresh();
          }
        }, 2_000);
      });
      this.userWatcher = w;
    } catch {
      // watcher unsupported on this fs (e.g. some network mounts) — fall back to
      // refresh-on-demand. The user can still hit "Refresh" from the UI.
    }
  }

  private attachProjectWatchers() {
    for (const project of this.projectsRef()) {
      const dir = projectTemplatesDir(project);
      if (!existsSync(dir)) continue;
      try {
        const w = watch(dir, { persistent: false }, () => this.scheduleRefresh());
        const projectId = project.id;
        w.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error(`[template-store] project ${projectId} watcher error:`, err);
          try {
            w.close();
          } catch {
            /* already closed */
          }
          if (this.projectWatchers.get(projectId) === w) {
            this.projectWatchers.delete(projectId);
          }
          this.scheduleRefresh();
        });
        this.projectWatchers.set(projectId, w);
      } catch {
        // ignore — same fallback as user dir.
      }
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
