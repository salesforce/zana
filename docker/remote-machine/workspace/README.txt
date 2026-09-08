This folder is the disk of the Docker remote machine (`zcc-docker`).

Zana can browse it after you enroll the container under Settings → Machines
and add a project at /home/zcc/workspace.

Live agent turns (optional): put OPENAI_API_KEY (OpenCode / Codex / Pi) and/or
CURSOR_API_KEY (Cursor) in the repo `.env` or your shell, then
`pnpm docker:host-daemon --local`. Keys are injected at container start — they
are never written into the image.
