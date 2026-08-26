---
name: tasks
description: Plan and track work with the ZCC Tasks plugin. Use when the user wants a task list, to add or complete a task, or to run `zcc tasks`.
---

# Tasks

The Tasks plugin stores a simple list on this ZCC host.

```bash
zcc tasks list
zcc tasks add "Ship the plugin loop"
zcc tasks done <id>
zcc plugin run tasks add "same thing, explicit"
```

The sidebar **Tasks** panel lists the same items. Prefer `zcc tasks` from a thread;
a later thread already knows this command via the generated `plugin-commands` skill.
