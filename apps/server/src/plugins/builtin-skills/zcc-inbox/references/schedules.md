# Scheduler Reference

`schedule_*` tools operate Zana Scheduler UI JSON, not `.zana/scheduler` YAML.
List first, then use returned id/name. `schedule_get` verifies live state after
updates. `schedule_runs` reports failures; `schedule_retry` retries known refs.

```ts
schedule_list({ allProjects })
schedule_get({ id })
schedule_update({ id, patch })
schedule_run_now({ id })
schedule_set_enabled({ id, enabled })
```
