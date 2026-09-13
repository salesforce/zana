---
name: tasks
description: Plan and track work with the ZCC Tasks plugin. Use when the user wants a task list or board, to add or update a task, or to run `zcc tasks`.
---

# Tasks

The Tasks plugin stores a Linear-style tracker on this ZCC host (plugin KV). The
sidebar **Tasks** panel shows the same items in a list (grouped by status) or a
board. Prefer `zcc tasks` from a thread; a later thread already knows this
command via the generated `plugin-commands` skill.

Keys look like `TSK-1`. Statuses are `backlog`, `todo`, `in_progress`,
`in_review`, `done`, and `canceled`. Priorities are `urgent`, `high`, `medium`,
`low`, and `none`.

## List

```bash
zcc tasks list
zcc tasks list --status todo --priority high
zcc tasks --help
```

Empty host → `No tasks.` Otherwise one row per item:

```
TSK-1    todo        high   Ship the plugin loop
TSK-2    in_progress        Write tests
```

`zcc plugin run tasks list` is the explicit equivalent.

## Add

```bash
zcc tasks add "Ship the plugin loop"
zcc tasks add "Review PR" --status in_review --priority high --due 2026-09-18
```

Prints `TSK-1  <title>`. A missing title is exit 2. Mention a task later with
the Tasks mention provider (`::task{key="TSK-1"}`).

## Show / update

```bash
zcc tasks show TSK-1
zcc tasks update TSK-1 --status in_progress --priority urgent
zcc tasks update TSK-1 --title "New title" --due 2026-09-20
```

Unknown key is exit 3. Missing key is exit 2.

## Done (toggle)

```bash
zcc tasks done TSK-1
```

Toggles `done` ↔ `todo`. Prints `<status>  <key>  <title>`. Unknown key is
exit 3. Missing key is exit 2.

## Don't

- Don't write a parallel JSON file for tasks — this plugin owns storage.
- Don't invent comment / attach / delegate / preset verbs. Those are not in
  this plugin.
- Don't shadow core `zcc` names. If `zcc tasks` is missing, the plugin is not
  installed; tell the user to enable **Tasks** in Plugins.
