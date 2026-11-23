Give an agent a name, a personality and a schedule. A bot is one persistent thread that anyone can talk to: you, other threads, or the CLI.

Turn on **Bots** in **Settings → Experimental** to get started. New installations start with Bots off. You can turn it off again and return to your bots and routines later.

## What you get

- A **Bots** panel. Create a bot, chat with it in its main thread, edit its routines, see its background jobs, and change its personality. Click the bot’s name at the top of its thread to open its profile, routines, library and settings beside the chat.
- **Routines.** Price checks and fixed messages post a result directly in the main chat. They can run every ten minutes and use zero model calls. Choose an AI prompt for tasks that need reasoning. These run at most every fifteen minutes and queue while the bot is busy. All schedules use five-field cron in host local time and run while the host is running. Expand **Recent runs** on a routine to check delivery or see a failure.
- **Background jobs.** For heavy work, the bot starts a hidden thread with `bot_job_start`. When the job finishes, its final answer is posted back to the bot, so the bot's thread stays readable.
- **Memory.** Each bot saves and searches `zcc memory` with its own tag (`bot:<id>`).
- **Agent tools** in every thread: `bot_list`, `bot_send`, `bot_create` and `bot_routines`. Bots also get `bot_reply` and `bot_job_start`.
- **CLI:** `zcc bots list | show | create | update | delete | send | routine`.

## A ten-minute Bitcoin update

Ask your bot “Every ten minutes, post Bitcoin in USD and CHF.” The bot can set up one **Price check**. Each run fetches Coinbase exchange rates and posts one line. Percentages compare with the last successfully delivered price for each currency. The first update establishes the baseline.

In the profile, choose **Add routine → Action → Price check** and **When → Every 10 minutes**. To convert an existing AI prompt, open its **More actions → Edit routine** and change its action and schedule. The CLI equivalent for a new routine is:

```sh
zcc bots routine add scout --name "Bitcoin price" --kind price --asset BTC --currencies USD,CHF --cron "*/10 * * * *"
```

## Vault

Open **Settings → Plugins → Bots → Vault** to manage the whole Vault, or open **Vault** in a bot’s profile to see items shared with that bot. Zana uses this device’s protected key storage. If you created a Vault with a passphrase, enter it once in the desktop app to migrate your existing items and grants.

Save a login, card or contact and choose the bots that may use it. Select **All current and future bots** to share an item with every bot. Editing a saved login or card lets you replace its secret fields. A bot’s main thread can use `bot_vault_list` to read its shared contacts and identify masked logins and cards. Passwords, card numbers, expiry dates and security codes are write-only.

## How it works

Bots are global. The project you set only decides where the bot's threads run. If you don't set one, the Default Project is used. Each bot runs with **full** permissions, including its background jobs.

Click a bot in the Basic sidebar to open its main thread. The first click creates an empty chat. Sending a message or running a routine can also create the thread. Opening or messaging a bot restores its archived thread, or creates a new one if its thread was deleted. A bot can run at most 3 background jobs at once, and keeps the last 50 job records.

## Salesforce connections

In the bot profile, open **Vault** and choose **Connect Salesforce**. Use the Salesforce My Domain URL and your external client app’s consumer key. Choose **Bot service account** for the client credentials flow with a designated integration user, or **My account** to authorize at Salesforce with the device flow. For delegated access, configure a local external client app dedicated to the device flow, with the callback URL `https://localhost` and the API and refresh-token scopes. [Salesforce device flow requirements](https://help.salesforce.com/s/articleView?id=005461280&language=en_US&type=1). For a service account, enable client credentials and assign a run-as user with Case read access.

Ask the bot to check its assigned cases, or use the same instruction in an AI prompt routine. This reads the 20 most recently modified open cases assigned to the connected identity. The bot receives the case ID, number, subject and status. It has no tool for retrieving credentials or running arbitrary queries.

Each grant belongs to one bot. Its credentials are encrypted on disk. Authorized routines can use their connections after a restart. To rotate an OAuth client secret, select **Replace consumer secret** and enter its replacement. **Disconnect** removes the bot’s local grant. To revoke the external app’s authorization as well, use Salesforce’s connected app settings.
