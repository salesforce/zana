---
name: inline-vis
description: Show a chart, demo, HTML report, or Markdown artifact inside the conversation. Use when the user should see a visualization without opening a separate tab first.
---

# inline-vis

Write a self-contained `.html` / `.htm` or `.md` / `.markdown` file, then emit
this leaf on its own line (not in a code fence):

```md
::vis{file="charts/out.html"}
```

`source` defaults to the thread workspace. Use `thread-storage` for files in
thread storage (no "open in side panel" action):

```md
::vis{file="notes.md" source="thread-storage"}
```

Optional `height` is a pixel integer from 120 to 1200 (default 224):

```md
::vis{file="charts/out.html" height="480"}
```

HTML renders in a sandboxed iframe. Markdown is rendered by the host with raw
HTML off. Workspace files keep an "Open" action into the thread side panel;
thread-storage previews do not.

`::doc` remains the Docs vault opener card — do not use `::vis` as a vault
shortcut, and do not use `::doc` for inline HTML/Markdown preview.

Use `preview_file` only when the user asked to inspect the source rather than
see the visualization.
