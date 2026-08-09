# Repair Routing Settings

Zana Command Center shows **Routing settings need repair** when it cannot safely
complete a one-time update of saved routing settings during startup.

The app pauses before loading projects, agents, schedules, or launches. This
prevents a partially updated settings file from changing how an agent starts.

## Retry Migration

Select **Retry migration** first. Retrying is safe: it resumes or repeats only
the incomplete verified migration steps. When it succeeds, Command Center opens
normally.

Do not edit files in the diagnostics folder before retrying. A changed file can
make the safety checks reject the migration again.

## Open Diagnostics

Select **Open diagnostics** to open this folder:

```text
~/.zcc/harness-routing-migration
```

It may contain migration journals and backup copies of settings created before
the update. Keep these files unchanged unless Command Center support asks for a
copy. The folder can be absent when startup failed before migration created its
first record; in that case Command Center opens `~/.zcc` instead.

## Quit Or Restart

Select **Quit** to stop Command Center without bypassing the repair. Starting
it again runs the same safety check and shows this screen again until migration
succeeds.

## Get Help

If retry keeps failing, send support:

- Command Center version and operating system version.
- What happened after selecting **Retry migration**.
- Copies of files in `~/.zcc/harness-routing-migration`, if present.

Do not include API keys, access tokens, SSH keys, or unrelated project files.
