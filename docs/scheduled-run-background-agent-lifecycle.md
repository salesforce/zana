# Scheduled Run Background-Agent Lifecycle

Hook-capable scheduled runs with `autoCloseOnFinish` now use main-owned Task lifecycle state before closing a session.

1. Parent `Stop` with no pending Task children closes session immediately.
2. Parent `Stop` with pending children marks run finished and defers close for up to 10 minutes.
3. `SubagentStop` reducing count to zero does not close session. Parent can process child result, publish inbox/Slack output, and file `schedule_report`.
4. Later parent `Stop` with zero pending children closes session once.
5. Missing child completion records `error: background subagent timed out` before expected close. Exit-time reconciliation preserves that error.

Non-hook providers retain existing 30-minute watchdog behavior. Parent Stop callbacks remain fire-and-forget.
