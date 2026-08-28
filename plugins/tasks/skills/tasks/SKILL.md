---
name: tasks
description: Plan and track work with the ZCC Tasks plugin. Use when the user wants a task list, to add or complete a task, or to run `zcc tasks`.
---

# Tasks

The Tasks plugin stores a simple list on this ZCC host (plugin KV). The sidebar
**Tasks** panel shows the same items. Prefer `zcc tasks` from a thread; a later
thread already knows this command via the generated `plugin-commands` skill.

This is the work loop. Do not invent tracker ids or comment/attach verbs — this
plugin only has list / add / done.

## List

```bash
zcc tasks list
zcc tasks --help
```

Empty host → `No tasks.` Otherwise one row per item:

```
  <id>  <title>     # open
x <id>  <title>     # done
```

`zcc plugin run tasks list` is the explicit equivalent.

## Add

```bash
zcc tasks add "Ship the plugin loop"
```

Prints `<id>  <title>`. A missing title is exit 2. Mention a task later with
the Tasks mention provider (`@title`).

## Done (toggle)

```bash
zcc tasks done <id>
```

Toggles `done`. Prints `done  <id>  <title>` or `open  <id>  <title>`. Unknown
id is exit 3. Missing id is exit 2.

## Don't

- Don't write a parallel JSON file for tasks — this plugin owns storage.
- Don't document ABC-12 / comment / attach / status / presets. Those verbs do
  not exist here.
- Don't shadow core `zcc` names. If `zcc tasks` is missing, the plugin is not
  installed; tell the user to enable **Tasks** in Plugins.
