Give an agent a name, a personality and a schedule. A bot is one persistent thread that anyone can talk to: you, other threads, or the CLI.

Turn on **Bots** in **Settings → Experimental** to get started. New installations start with Bots off. You can turn it off again and return to your bots and routines later.

## What you get

- A **Bots** panel. Create a bot, chat with it in its main thread, edit its routines, see its background jobs, and change its personality. Click the bot’s name at the top of its thread to open its profile, routines, library and settings beside the chat.
- **Routines.** A routine posts a prompt into the bot's thread on a 5-field cron, in host local time. Ranges such as `1-5` work. A routine that fires while the bot is busy waits until its turn ends.
- **Background jobs.** For heavy work, the bot starts a hidden thread with `bot_job_start`. When the job finishes, its final answer is posted back to the bot, so the bot's thread stays readable.
- **Memory.** Each bot saves and searches `zcc memory` with its own tag (`bot:<id>`).
- **Agent tools** in every thread: `bot_list`, `bot_send`, `bot_create` and `bot_routines`. Bots also get `bot_reply` and `bot_job_start`.
- **CLI:** `zcc bots list | show | create | update | delete | send | routine`.

## Vault

Open **Settings → Plugins → Bots → Vault** to manage the whole Vault, or open **Vault** in a bot’s profile to see items shared with that bot. Create a passphrase to encrypt the Vault on this Zana instance. Unlocking lasts 30 minutes. Restarting or disabling the plugin locks it sooner.

Save a login, card or contact and choose the bots that may use it. Select **All current and future bots** to share an item with every bot. Editing a saved login or card lets you replace its secret fields. A bot’s main thread can use `bot_vault_list` to read its shared contacts and identify masked logins and cards. Passwords, card numbers, expiry dates and security codes are write-only.

## How it works

Bots are global. The project you set only decides where the bot's threads run. If you don't set one, the Default Project is used. Each bot runs with **full** permissions, including its background jobs.

Click a bot in the Basic sidebar to open its main thread. The first click creates an empty chat. Sending a message or running a routine can also create the thread. Opening or messaging a bot restores its archived thread, or creates a new one if its thread was deleted. A bot can run at most 3 background jobs at once, and keeps the last 50 job records.
