# Ways to start a Squad

You can start a Squad from the Squad composer, from a conversation, from a Goal, from a schedule, or from the `zcc` CLI. This page covers each path, what you can attach, and what is refused.

New to Squads? Start with [Your first Squad](/docs/squads-start/). To follow a run once it starts, see [Watching a Squad](/docs/squads-watch/). To pick a Squad, see [The Squad catalogue](/docs/squads-catalogue/).

## Plan provided in goal or Infer plan from goal

Every path asks how the Squad gets its plan. The labels are the same everywhere.

- **Plan provided in goal.** The goal, or a file you attach, contains the plan. The host registers it and dispatches work before the Orchestrator starts. This is the path to learn first.
- **Infer plan from goal.** The Orchestrator writes the plan from your goal. See [Customizing a Squad](/docs/squads-customize/) for how it works.

Where the choice appears:

- Squad composer: **Squad planning**.
- Goals: **Squad planning**.
- Schedules: **Squad planning**.
- Squad editor: **Default planning**, with the extra choice **Use the global default**.
- Settings, Agents: **Default plan mode**, the starting selection for a new Squad launch.

## The 2,048-character goal limit

A Squad goal can be at most 2,048 characters. The summary has the same limit.

The composer shows a counter when the goal reaches 90 percent of the limit. Past the limit, the Launch button reads "Goal is too long for a Squad" and the composer shows this message.

> The goal is too long for a Squad (N of 2,048 characters). Move details into an attached plan or source.

Attached image paths are added to the goal, so a goal can pass the limit after you attach an image. The same limit applies on every path. Put long plans in a file and attach it as a source.

## Squad composer

This is the main path.

1. Open **New agent** and choose **Squad** in the **Launch mode** switcher. The dialog is titled "New squad". The switcher shows **Squad** when Squad mode is on in Settings (the **Squad** checkbox under Launch surfaces) and at least one Squad exists.
2. Describe the goal in the text box. It is required.
3. Pick the Squad.
4. Choose **Squad planning**.
5. Pick the Project.
6. Optionally add a Title and a Summary. The title placeholder is "Defaults from goal".
7. Optionally attach files, images or sources.
8. Press **Launch squad**, or use the keyboard shortcut shown in the text box.

When the Squad starts, a toast says "Squad launched. Open Agents board to monitor it." Then follow the run in [Squad details](/docs/squads-watch/).

If something blocks the launch, the composer says why.

- "Squad requirements need attention" lists missing Skills and MCP servers. Choose **Configure project**, **Edit plan** or **Cancel**.
- "Project capabilities could not be verified" offers **Retry** or **Cancel**.

Launching from the composer never waits for approval. The Launch approval setting only applies to agents that start a Squad on their own.

## From a conversation

An agent in a conversation can prepare a Squad launch for you. It uses `squad_propose`, or `squad_launch` with a mode.

**Review (the default).** An Inbox card titled "Squad launch ready:" followed by the Squad title appears. It includes the effective launch settings and execution location. Existing worktrees show effective branch and path as user-owned; a new worktree shows its base branch and effective isolation source, not a path that does not exist yet. The buttons are **Review Squad launch** and **Dismiss**.

**Review Squad launch** opens the Squad composer already filled in. A note reads "Prepared by" followed by the conversation title. It shows "Plan checked: N steps" when the plan was checked. It also says: "Files are captured when you press Launch, so later edits are not included. When the Squad finishes or needs you, it reports back to that conversation." You press **Launch squad** to start it.

**Run now.** `squad_launch` with mode `now` starts the Squad at once, with no extra Inbox card. Its receipt shows effective settings and actual execution location. The calling conversation becomes the owner, answers the Squad's questions and gets its reports. An agent should use it only when you ask to run now.

Limits for agent launches:

- A pending proposal expires after 7 days.
- A Project holds up to 20 pending proposals.
- Members of a running Squad cannot propose or launch.

### Launch approval

Launch approval decides whether an agent may start a Squad without you.

- **Project setting.** Settings, Project, **Squad launch approval**, field **Launch approval**. Choices: **Agents can launch directly** or **Review before launch**.
- **Squad setting.** In the Squad editor, **Launch approval**. Choices: **Use the Project setting**, **Agents can launch directly if the Project allows**, or **Review before launch**.

Review wins. If the Squad or its Project says **Review before launch**, an agent cannot use mode `now`, even with an explicit target. It gets `LAUNCH_REVIEW_REQUIRED` and must propose the launch for you to approve.

Launching from the composer, schedules and triggers is not affected.

## Goals

A Goal can run as an Agent or as a Squad.

Goals are off by default. Turn them on in **Settings → Experimental → Goals**. Until then a Project has no Goals tab and you cannot create a Goal.

1. Open the Goals tab in a Project, then press **New goal**.
2. Set **Run as** to **Squad**.
3. Choose the **Squad**, the **Project**, and **Squad planning**. The full **Launch preview** opens automatically, showing the location and every effective launch setting with its source.
4. Write the **Plan or prompt**. With **Plan provided in goal**, this is where the plan goes.
5. Set **Max iterations** and the no-progress limit.

Each iteration runs as a durable squad job. Launch overrides are saved with the Goal and apply to every iteration. Changing **Run as** back to **Agent** clears Squad launch overrides.

## Schedules

A schedule can also run a Squad.

1. Open the schedule form.
2. Set **Run as** to **Squad**.
3. Choose the **Squad**, the **Project**, and **Squad planning**. The full **Launch preview** opens automatically, showing the location and every effective launch setting with its source.
4. Write the prompt text.
5. Set the cadence, **Missed runs**, **Auto-retry** and Inbox notifications.

The form says: "Runs this schedule as a durable squad job." Schedules skip Launch approval. The plan comes from the prompt text only. **Run now** first opens **Review scheduled squad launch**, which shows the location and every effective setting with its source before **Launch schedule** is enabled.

For a Squad schedule, **Customize launch** saves schedule-specific overrides.
Scheduler options do not bypass normal
target validation or worktree ownership rules.

## From the CLI

The CLI command is `team`. Zana must be running.

```bash
zcc team ls
zcc team launch --team <id> --project <id|path> --goal "ship it" [--mode freeform|structured] [--worktree true|false] [--on-complete leave|merge|delete] [--push] [--check <name>]... [--target project-root|worktree:<branch>] [--title <text>] [--summary <text>] [--wait] [--timeout 5m]
zcc team status <executionId>
zcc team wait <id> [--timeout 5m]
zcc team answer <id> --text "yes" [--blocker <blockerId>]
zcc team stop <id>
```

Notes:

- `--goal` takes text, or `@file` to read the goal from a file.
- A path passed to `--project` is registered only after trusted main-process
  confinement: realpath under your home or configured clone root. Existing
  registration is idempotent. Invalid or unconfined paths fail.
- `--mode structured` is **Plan provided in goal**. `--mode freeform` is **Infer plan from goal** and is the default.
- A prose goal with `--mode structured` is refused with `INVALID_PLAN`.
- Before launch, the CLI emits trusted effective settings and location to stderr.
  Normal launch output and the exact streamed `--wait` result payload remain on
  stdout.
- `--wait` prints the terminal result payload, not only status. `--timeout`
  defaults to `5m`.
- The CLI has no flags for sources.
- Launch, answer and stop are for the person at the machine, not for agents.

## The Launch button in Settings, Squads

Each row on the Squads page has a **Launch** button. It is not a Squad run.

- Choose a Project, or it uses the only one available. The menu is titled "Launch in…".
- It starts the Squad's agents as sessions in that Project with no goal and no plan.
- It does not create a Squad run, so nothing appears in Squad details or on the Jobs page.
- The row lists "Launched sessions" and offers **Cancel launch**.

To run a Squad with a goal, use the composer.

## Attaching sources

Sources are files the Squad works from. In the composer, use **Attach sources** or drop files in. Chips appear under "Attached sources". A file from outside the Project is tagged "outside the Project".

Rules:

- A source must be a file inside the Project, your home folder or the clone root.
- Each file can be up to 4 MiB. Together, sources can total up to 16 MiB.
- Files are captured when you press Launch. Later edits are not included.
- Credential stores, agent sessions, the app's own data and Zana's data folders are refused. The `library`, `personas`, `teams`, `templates`, `saved`, `worktrees`, `checkouts` and `personal-workspaces` folders inside Zana's data folders can be attached.
- A link that leads into a refused place is refused too.

Refusal messages:

- "`<path>` is in a protected location, so it can't be attached."
- "`<path>` is reached through too many links, so it can't be attached."
- "`<path>` is outside this project, your home folder and the clone root, so it can't be attached." (The list names only the places allowed in your setup.)
- "`<path>` does not exist or is not a file."
- "`<path>` is not a regular file."
- "`<path>` is a hard-linked file, so it can't be attached (it may be a second name for a protected file)."

Each message is followed by a short description of what a source may be.

For agent launches, a file named in the goal that sits outside the Project must also be listed in the proposal's sources. Otherwise the launch is refused with `SOURCE_NOT_ALLOWED`. When the agent started the Squad itself, the message reads: "The goal names `<path>`, which is outside this project and was not listed in sources. List it in `sources`, or remove it from the goal." When it comes from a reviewed proposal, the message says the file "was not listed in the proposal's sources, so the card did not show it". The agent fixes this by listing the file in `sources` or removing it from the goal. On a reviewed proposal, the card shows the file before you press Launch.

## Attachments from agents

An agent can pass text that is not on disk as attachments (`attachments: [{ name, text }]` on `squad_propose` and `squad_launch`). Attachments and sources share one budget: 16 items, 4 MiB each, 16 MiB in total. Names are plain file names of at most 128 UTF-8 bytes.

- Names are NFC-normalised and compared without regard to case.
- The same name with identical content is folded into one (deduplicated).
- The same name with different content gets a " (n)" suffix, such as "plan (1).md". A numbered name over 128 bytes is refused with `NAME_TOO_LONG`.
- The result lists each attachment as `{ given, used, deduplicated? }`.
- A plan is limited to 1 MiB.

When a launch is reviewed, Zana keeps attachments as private copies (owner-only, 0700 folders and 0600 files, not encrypted) in its data folder until the launch is started, dismissed or expired. Together they are capped at 64 MiB. When that is full, dismiss old proposals or start the Squad now. The review card shows: "Attached content was captured when this launch was prepared. Anything changed after that is not included, and the Squad will use only the captured version."

## Remote and SSH Projects

A registered Project bound to SSH can launch a Squad on its configured remote
default path. This supports Infer plan from goal, Plan provided in goal, inline
provided plans, and locally attached source capabilities. Remote launch preview
does not read, realpath, or otherwise inspect a local checkout placeholder.

Remote Projects do not support explicit execution targets, generated worktree
isolation, named checks, or the push capability. Each is rejected during preview
and admission; Zana does not fall back to a local checkout or another target.

For locally attached source capabilities, relative paths are unavailable because
the remote Project has no local project-root authority. Attach an allowed local
file by absolute path. The coordinator reads approved attachment content through
`execution.source`; no plan handoff file is written to the remote host.

A Project on a secondary machine without a remote cannot. The launch is refused with this message.

> Squad/Team execution on secondary machines is not available yet. Choose a project on the primary machine.

## Troubleshooting a refused launch

- "<Orchestrator name> can't author and register a plan on this Squad's transport, so Infer plan from goal can't finish. Provide the plan in the goal instead." Choose **Plan provided in goal**.
- "Team requires an orchestrator". The Squad has no Orchestrator. Fix it in the Squad editor.
- "Team has no launchable slots". The Squad has no members to start.
- "Team jobs are disabled". Squad execution is switched off.
- A run that stopped partway: see [Watching a Squad](/docs/squads-watch/) for **Relaunch Squad from retained plan** and **Resume existing Squad**.
