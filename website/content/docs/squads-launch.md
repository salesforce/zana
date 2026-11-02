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

**Review (the default).** An Inbox card titled "Squad launch ready:" followed by the Squad title appears. It says: "Review opens the Squad composer filled in. Nothing starts until you press Launch." The buttons are **Review Squad launch** and **Dismiss**.

**Review Squad launch** opens the Squad composer already filled in. A note reads "Prepared by" followed by the conversation title. It shows "Plan checked: N steps" when the plan was checked. It also says: "Files are captured when you press Launch, so later edits are not included. When the Squad finishes or needs you, it reports back to that conversation." You press **Launch squad** to start it.

**Run now.** `squad_launch` with mode `now` starts the Squad at once, with no Inbox card. The calling conversation becomes the owner, answers the Squad's questions and gets its reports. An agent should use it only when you ask to run now.

Limits for agent launches:

- A pending proposal expires after 7 days.
- A Project holds up to 20 pending proposals.
- Members of a running Squad cannot propose or launch.

### Launch approval

Launch approval decides whether an agent may start a Squad without you.

- **Project setting.** Settings, Project, **Squad launch approval**, field **Launch approval**. Choices: **Agents can launch directly** or **Review before launch**.
- **Squad setting.** In the Squad editor, **Launch approval**. Choices: **Use the Project setting**, **Agents can launch directly if the Project allows**, or **Review before launch**.

Review wins. If the Squad or its Project says **Review before launch**, an agent cannot use mode `now`. It gets `LAUNCH_REVIEW_REQUIRED` and must propose the launch for you to approve.

Launching from the composer, schedules and triggers is not affected.

## Goals

A Goal can run as an Agent or as a Squad.

1. Open the Goal form.
2. Set **Run as** to **Squad**.
3. Choose the **Squad**, the **Project**, and **Squad planning**.
4. Write the **Plan or prompt**. With **Plan provided in goal**, this is where the plan goes.
5. Set **Max iterations** and the no-progress limit.

Each iteration runs as a durable squad job.

## Schedules

A schedule can also run a Squad.

1. Open the schedule form.
2. Set **Run as** to **Squad**.
3. Choose the **Squad**, the **Project**, and **Squad planning**.
4. Write the prompt text.
5. Set the cadence, **Missed runs**, **Auto-retry** and Inbox notifications.

The form says: "Runs this schedule as a durable squad job." Schedules skip Launch approval. The plan comes from the prompt text only.

## From the CLI

The CLI command is `team`. Zana must be running.

```bash
zcc team ls
zcc team launch --team <id> --project <id> --goal "ship it" [--mode freeform|structured] [--wait]
zcc team status <executionId>
zcc team wait <id> [--timeout 5m]
zcc team answer <id> --text "yes" [--blocker <blockerId>]
zcc team stop <id>
```

Notes:

- `--goal` takes text, or `@file` to read the goal from a file.
- `--mode structured` is **Plan provided in goal**. `--mode freeform` is **Infer plan from goal** and is the default.
- A prose goal with `--mode structured` is refused with `INVALID_PLAN`.
- You can also pass `--title` and `--summary`.
- With `--wait`, the command waits for the run. `--timeout` defaults to `5m`.
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

## Remote and SSH Projects

A Project bound to an SSH remote can launch Squads. In the composer, files you attach are uploaded to the remote host first, and a toast says "Uploaded `<name>` to `<host>`".

A Project on a secondary machine without a remote cannot. The launch is refused with this message.

> Squad/Team execution on secondary machines is not available yet. Choose a project on the primary machine.

## Troubleshooting a refused launch

- "<Orchestrator name> can't author and register a plan on this Squad's transport, so Infer plan from goal can't finish. Provide the plan in the goal instead." Choose **Plan provided in goal**.
- "Team requires an orchestrator". The Squad has no Orchestrator. Fix it in the Squad editor.
- "Team has no launchable slots". The Squad has no members to start.
- "Team jobs are disabled". Squad execution is switched off.
- A run that stopped partway: see [Watching a Squad](/docs/squads-watch/) for **Relaunch Squad from retained plan** and **Resume existing Squad**.
