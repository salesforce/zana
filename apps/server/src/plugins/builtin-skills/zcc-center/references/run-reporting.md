# Scheduled Run Reporting

Use `schedule_report` at end of every scheduled run. Summary is short Markdown: what ran, outcome, changes, and user action. `status` is `success`, `partial`, or `failure` and is independent of process exit. Report attaches only to current run.

Use `inbox_push` only when user needs attention. `schedule_report` is run history; inbox is proactive notification. When `autoCloseOnFinish` is true, submit report before final response because session stops immediately after response.
