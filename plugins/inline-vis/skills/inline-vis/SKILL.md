---
name: inline-vis
description: Show a chart, demo, HTML report, or Markdown artifact inside the conversation. Use when the user should see a visualization without opening a separate tab first.
---

# inline-vis

## Remote conversations

If the host identifies a remote chat as the controlling surface, the user cannot see Zana's desktop panels or inline visualization UI. Do not follow the desktop presentation steps below. Return useful text through the configured conversation delivery tool; use a supported remote artifact or authenticated web-preview link only when available. Do not claim that a local file path, localhost URL, or desktop panel was shown to the remote user. Hidden browser automation and file creation for your own work remain available. A desktop handoff must be opened by the user in Zana.


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

`::doc` remains the Library document card — do not use `::vis` as a Library
shortcut, and do not use `::doc` for inline HTML/Markdown preview.

Use `preview_file` only when the user asked to inspect the source rather than
see the visualization.
