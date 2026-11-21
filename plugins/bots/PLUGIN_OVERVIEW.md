Give an agent a name, a personality and a schedule. A bot is one persistent thread that anyone can talk to: you, other threads, or the CLI.

## What you get

- A **Bots** panel. Create a bot, chat with it in its main thread, edit its routines, see its background jobs, and change its personality.
- **Routines.** A routine posts a prompt into the bot's thread on a 5-field cron, in host local time. Ranges such as `1-5` work. A routine that fires while the bot is busy waits until its turn ends.
- **Background jobs.** For heavy work, the bot starts a hidden thread with `bot_job_start`. When the job finishes, its final answer is posted back to the bot, so the bot's thread stays readable.
- **Memory.** Each bot saves and searches `zcc memory` with its own tag (`bot:<id>`).
- **Agent tools** in every thread: `bot_list`, `bot_send`, `bot_create` and `bot_routines`. Bots also get `bot_reply` and `bot_job_start`.
- **CLI:** `zcc bots list | show | create | update | delete | send | routine`.

## How it works

Bots are global. The project you set only decides where the bot's threads run. If you don't set one, the Default Project is used. Each bot runs with **full** permissions, including its background jobs.

A bot's thread is created on first contact. If you delete that thread, the next message starts a new one. Archived threads are unarchived when a message arrives. A bot can run at most 3 background jobs at once, and keeps the last 50 job records.
