---
name: inline-vis
description: Show a chart, demo, or HTML report inside the conversation. Use when the user should see a visualization without opening a separate tab first.
---

# inline-vis

Write a self-contained `.html` or `.htm` file in the thread workspace, then emit
this leaf on its own line (not in a code fence):

```md
::vis{file="charts/out.html"}
```

Optional `height` is a pixel integer from 120 to 1200 (default 224):

```md
::vis{file="charts/out.html" height="480"}
```

The card renders the HTML in the message. A header action opens the source file
in the thread side panel. Use `preview_file` only when the user asked to inspect
the source rather than see the visualization.

Do not use this for Markdown documents — emit `::doc{path="..." title="..."}`
instead.
