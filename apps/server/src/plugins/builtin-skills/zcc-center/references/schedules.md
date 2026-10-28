# Schedules

Directories: global `~/.zcc/schedules/`; project `<project-root>/.zcc/schedules/`. Filename is `<id>.json`. Project scope keeps automation in clone; global scope supports user work. App watches files.

Resolve `projectId` from `~/.zcc/projects.json`; unknown project skips every fire. Do not invent ID.

```json
{
  "id": "qa-hourly",
  "name": "Hourly QA sweep",
  "enabled": true,
  "projectId": "real-project-id",
  "profile": "claude-yolo",
  "extraArgs": [],
  "prompt": "Run tests and summarize failures.",
  "schedule": { "every": "1h" },
  "catchUp": { "mode": "once" },
  "overlap": "skip",
  "history": { "retain": 10 },
  "status": { "runCount": 0, "runs": [] },
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

Required: `id`, `name`, `enabled`, `projectId`, `profile`, `schedule`, `overlap`, `history.retain`, `status`, `createdAt`, `updatedAt`. Profiles: `shell`, `claude`, `claude-resume`, `claude-yolo`. `shell` ignores prompt. `claude-yolo` uses skip-permissions; use only safe unattended work. `autoCloseOnFinish` only applies Claude profiles.

Set exactly one cadence. `every` combines `ms`, `s`, `m`, `h`, `d` segments, minimum 60 seconds and maximum 24 days. `cron` is five-field cron with optional IANA `tz`. `catchUp` is `{ "mode": "once" | "skip" | "all", "max"?: 1-10 }`; include `{ "mode": "once" }` for new schedules. `all` replays up to `max` missed runs (default 3); absent catchUp retains legacy behavior. `retry` is `{ "attempts": 0-5, "delayMinutes": 1-1440 }`; it retries temporary failures up to `attempts` times with delay multiplied by attempt number. `overlap` is `skip`. `inboxLevel` is `silent`, `quiet`, or `loud`.

To direct-edit existing schedule, change definition and `updatedAt`, preserve `status`, then `schedule_reload`. Prefer `schedule_update({ id, patch })`; read with `schedule_get`.
