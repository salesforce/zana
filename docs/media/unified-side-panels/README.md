# Unified plugin side panels

`unified-side-panels.mp4` is a 67-second screen capture: 1440 × 900, H.264/yuv420p,
no audio, fast-start playback. `poster.jpg` is its frame at 0:30.

It walks through the shared side panel host from 6540bef8 ("fix: unify plugin side
panels across app surfaces"):

1. **Design Docs** (global page): the side-panel rail sits flush on the right edge.
   **Show right panel** opens the shared New Tab page; an **Agent** tab opens beside
   the page, resizes by drag, maximizes and restores; closing the tab and hiding the
   panel returns to the rail; **Ask agent** opens the agent directly.
2. **Tasks**: the same rail and panel.
3. **Project → Design, Library, Salesforce**: project views use the same panel host;
   on Salesforce the New Tab page also lists the Agent Script Studio tools.

Captured from a dev build's renderer against the dev server. The org name and local
paths are replaced with samples (`my-dev-sandbox`, `~/projects/`).
