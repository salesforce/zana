export interface GuideChapter {
  id: string;
  title: string;
  content: string;
}

export const GUIDE_CHAPTERS: readonly GuideChapter[] = [
  {
    id: 'overview',
    title: 'Overview',
    content: `zcc is the command-line interface to Zana Command Center.

Core concepts:

- Project — a registered repository. Threads belong to a project.
- Thread — a single agent conversation. The fundamental unit of work.
- Machine — an execution host (this laptop or an enrolled remote).
- Terminal — a persistent PTY, distinct from an agent thread.
- Plugin — in-process extension that can add a zcc verb, skills, and UI.

Prefer --json when command output will drive follow-up work.
Run zcc guide <chapter> for command details.

Chapters: threads, projects, machines, terminals, plugins, automations, agent-configuration, environments.
`
  },
  {
    id: 'threads',
    title: 'Threads',
    content: `zcc thread is the primary agent surface.

  zcc thread list [--project <id>]
  zcc thread spawn --project <id> --prompt "..." [--provider <id>] [--wait]
  zcc thread show <id>
  zcc thread log <id>
  zcc thread tell <id> "..."
  zcc thread wait <id> [--timeout 20m]
  zcc thread stop <id>
  zcc thread fork|archive|unarchive <id>
  zcc thread open <id> [--file PATH] [--source workspace|thread-storage] [--line N]
  zcc thread interactions <id>

zcc run and zcc agent send are deprecated aliases for spawn and tell.
Give spawned threads a clear objective, constraints, deliverable, and what to report back.
`
  },
  {
    id: 'projects',
    title: 'Projects',
    content: `  zcc project list
  zcc project show <id>
  zcc project create --path <absolute-path> [--host <id>]
  zcc project files <id> [--query <text>]
  zcc project content <id> <path>
  zcc project skills <id>

zcc projects ls remains as an alias of project list.
`
  },
  {
    id: 'machines',
    title: 'Machines',
    content: `  zcc machine list
  zcc machine show <id>
  zcc machine join-code
  zcc machine rename <id> <name>
  zcc machine remove <id>
  zcc machine provider-cli status|install <id> [provider]
`
  },
  {
    id: 'terminals',
    title: 'Terminals',
    content: `Use zcc terminal for long-running PTYs (dev servers, watches). Use zcc thread for agents.

  zcc terminal list [--project <id>]
  zcc terminal create --project <id> [--title ...] [--command ...]
  zcc terminal send <id> --text "..."
  zcc terminal close <id>

zcc term is a deprecated alias.
`
  },
  {
    id: 'plugins',
    title: 'Plugins',
    content: `  zcc plugin new <name> [--app]
  zcc plugin install <source>
  zcc plugin list|dev|reload|logs|run ...
  zcc marketplace ls|add|refresh|remove

Contributed verbs appear as zcc <name> and in the generated plugin-commands skill.
Core command names always win. Combined plugin output is capped at 1MiB.
Writing a plugin? Use the zcc-plugin-authoring skill.
`
  },
  {
    id: 'automations',
    title: 'Automations',
    content: `Schedules are still listed and toggled with:

  zcc schedule ls
  zcc schedule run-now <id>
  zcc schedule enable|disable <id>

Prefer these CLI verbs over writing JSON into ~/.zcc/schedules. The zcc-center skill is a file-format appendix only.
`
  },
  {
    id: 'agent-configuration',
    title: 'Agent configuration',
    content: `Inside a Zana agent terminal the app sets ZCC_SESSION_ID. Mutating live ops then return FORBIDDEN_AGENT (exit 5), except a host-stamped orchestrator which may spawn and close workers.

  zcc skill list
  zcc skill show <id>
  zcc skill install-cli-skills
  zcc skill cli-skills-status

install-cli-skills copies the zcc-cli skill onto each machine's ~/.claude/skills and ~/.agents/skills so agents outside ZCC can drive the CLI.
`
  },
  {
    id: 'environments',
    title: 'Environments',
    content: `Inspect an existing environment (checkout or worktree) by id:

  zcc environment status <id>
  zcc environment diff <id>
  zcc environment diff-files <id>
  zcc environment pull-request <id>
`
  }
];

export function renderGuide(chapter?: string): { id: string; title: string; content: string } {
  if (!chapter) {
    const overview = GUIDE_CHAPTERS.find((row) => row.id === 'overview')!;
    return overview;
  }
  const match = GUIDE_CHAPTERS.find((row) => row.id === chapter || row.id === chapter.replace(/_/g, '-'));
  if (!match) {
    const known = GUIDE_CHAPTERS.map((row) => row.id).join(', ');
    return {
      id: 'unknown',
      title: 'Unknown chapter',
      content: `Unknown guide chapter '${chapter}'. Try: ${known}\n`
    };
  }
  return match;
}
