# Using Zana on multiple machines

There are two separate ways to use another computer with Zana:

- **Enrolled machines** run a host daemon. The other box outbound-connects to
  this app. Add a folder on that machine from **Settings → Machines** (or the
  host picker when adding a local project). Threads then execute there.
- **SSH remotes** are a workspace on a host from `~/.ssh/config`. New threads
  default to **This machine**: the coding agent runs here and file/shell tools
  (`remote_read`, `remote_write`, `remote_edit`, `remote_glob`, `remote_grep`,
  `remote_exec`) run on the box over SSH. Composer shows **Local agent · remote
  tools**. Optionally install a host daemon on that box (**Add remote**
  checkbox, on by default, or composer **Install**). After it connects, pick
  **This machine** (SSH tools) or **Remote machine** (threads execute on the
  enrolled daemon). This machine's host daemon must be connected (it owns
  `~/.ssh`).

Copy-paste join remains for boxes you cannot SSH to from this machine.

---

## Reachability (public origin)

The product server still binds **loopback** (`127.0.0.1`). Another computer
cannot enroll against `http://127.0.0.1:<port>`. Official desktop builds carry
the public Heroku origin and relay token (inlined at `electron-vite build` from
`ZCC_APP_URL` and `ZCC_RELAY_TOKEN`). This laptop dials
`wss://<origin>/_zcc/relay` — Heroku never inbound-connects to the laptop.

Precedence: runtime env, then the values baked into that build. Settings and
the repo `public-app-url` file are not used. Do not commit the token; set the
same `ZCC_RELAY_TOKEN` on Heroku and in the release/CI environment (GitHub
secrets `ZCC_APP_URL` / `ZCC_RELAY_TOKEN`, or export them before
`pnpm run release:mac`).

The token authenticates a laptop to open a session. Isolation between laptops
is the session URL (`/t/<sessionId>`), not a personal key. Join/enroll through
that id expires after **5 minutes**; already connected host websockets keep
working until this app quits.

Join commands use `https://<origin>/t/<sessionId>` so remotes route to the
right laptop.

If the origin is baked/set but the tunnel is down, Install fails with
`relay_offline` (keep Zana running). Dev builds without those env vars stay
loopback; use SSH reverse-tunnel pairing.

That origin is used in the join command and as the **Host-header allowlist**
on the laptop (enroll, host websocket, `/install.sh`).

The Heroku dyno has a separate **path allowlist** (`website/relay/allowlist.json`,
mirrored in the product server): `/install.sh`, `/install/version`,
`/install/zcc-host.tgz`, enroll, interactive-request (and interrupt), and
`/internal/hosts/ws`. Other product HTTP — including `/internal/hosts/tool-call`
— is not relayed.

Operator detail for the front door (`ZCC_RELAY_TOKEN`, `node relay/front-door.mjs`)
is in [`website/README.md`](../website/README.md).

Do **not** bind the product server to `0.0.0.0` or use Tailscale Funnel. Those
would put an unauthenticated control plane on a network.

Opening the full Zana UI in a browser through that URL is out of scope — the
desktop app on this machine stays the control surface. SSH reverse-tunnel
copy-paste (below) remains the offline fallback.

---

## Add an execution machine

1. Open **Settings → Machines** and choose **Add a machine**.
2. Copy the one-line installer. It looks like:

```bash
curl -fL ${publicAppUrl}/install.sh | sh -s -- \
  --join-code <zcde_...> --host-id <id> --server ${publicAppUrl}
```

3. Run it on the computer that should execute work. The join code expires in
   **15 minutes** and can be redeemed once. The Machines list turns the new row
   online when the daemon's websocket is open.

If the machine is an SSH workspace (for example `limited-pony`) and you have
not set a public app URL, Add machine copies a **laptop-side** command instead:

```bash
ssh -o ExitOnForwardFailure=yes -R 18782:127.0.0.1:<zcc-port> limited-pony \
  'curl -fL … http://127.0.0.1:18782/install.sh | sh -s -- --join-code … --host-id … --server http://127.0.0.1:18782'
```

Paste that in a terminal **on this computer**. It reverse-tunnels product HTTP
to the workspace and runs the installer there. Leave the SSH session open so
the daemon can keep that tunnel. The installer looks for **Node 22+** on PATH,
then nix / nvm / fnm / volta (a Node 20 PATH entry is skipped). Override with
`ZCC_NODE=/path/to/node`.

The installer requires **Node.js 22 or newer** on the remote box. Manual
pairing downloads the host-daemon tarball from `/install/zcc-host.tgz`. Composer
**Fix** (enrolled machines that are offline) pipes that same tarball over SSH
from this machine instead of asking the remote to `curl` it.

Each joined server gets its own daemon instance and data directory
(`~/.zcc-machines/<server-host>`). Joining never touches a full local install's
`~/.zcc`. Subsequent runs reuse the reserved local API port under
`~/.zcc-machines/host-daemon-ports/`; pass `--host-daemon-port <port>` to
override.

On macOS the installer loads a LaunchAgent. On Linux it enables a systemd user
unit when that bus is available; Salesforce workspaces and other boxes without
user systemd keep the daemon running in the background instead of hanging.
Both start the daemon with `--auto-update`.

---

## Fix from the composer

When an already-paired machine is offline, the composer shows **Fix**. If Zana
stored an SSH alias for that host, Fix restarts the LaunchAgent or systemd user
unit and reinstalls if restart does not reconnect. If no SSH alias is stored,
Fix asks you to pick a host from `~/.ssh/config`, then retries.

Fix needs a public origin (baked into the official app, or `ZCC_APP_URL`), not
loopback. This machine's host daemon must be connected — it owns `~/.ssh` and
performs the SSH. If SSH cannot run, copy the Settings → Add machine join command.

**Add remote project** registers the SSH workspace and, by default, installs a
host daemon over SSH. Uncheck the install box (or skip after a failed install)
to keep using this machine with SSH tools. Composer **Install** stays available
until a daemon is bound. After install, pick **This machine** or **Remote
machine**. Send is blocked only when **Remote machine** is selected and that
daemon is offline. **This machine** keeps working as long as this machine's
daemon is connected.

---

## After it connects

1. **New project** — pick the machine in the host picker and browse its disk
   (or paste a path on that box).
2. **New thread / home composer** — pick the machine when more than one host is
   connected, or when an enrolled machine is offline (Online/Offline in the
   picker). A project remembers the host it was created on.
3. **Provider CLIs** — each machine row lists Codex / Claude (and other)
   CLI install state. Use **Update all** when any enrolled box is missing or
   outdated.
4. **Permission ceiling** — Settings → Machines can cap that box at accept-edits
   or auto. Owner-session only; a thread cannot exceed the ceiling.

Machine names are labels and may be duplicated; the host id is the stable
handle. The laptop that runs the product server is the **primary** machine and
cannot be removed from the list.

---

## Local Docker trial

A Linux box lives in `docker/remote-machine`. It is
the same enroll path as a real remote: Node 22, `/home/zcc/workspace`, SSH on
port 2222, no systemd user bus (the installer nohups).

Start it and leave it idle:

```bash
pnpm docker:remote-machine
```

Then either paste the Settings → Add a machine command inside the box:

```bash
docker exec -it zcc-docker bash
# or: ssh -p 2222 zcc@127.0.0.1   (password: zcc)
zcc-join --join-code <zcde_...> --host-id <id> --server <url>
```

Or mint and enroll in one step (`pnpm dev` must be running). If the laptop
relay is connected, this uses `https://<origin>/t/<sessionId>`; otherwise it
publishes a loopback proxy so Docker can reach `127.0.0.1`:

```bash
pnpm docker:host-daemon
```

Force a door with `--relay` or `--local`. Prove a Linux box can enroll through
the session join URL with `pnpm test:docker:pairing` (needs Docker). Stop with
`pnpm docker:remote-machine down`.

Settings → Machines should show hostname `zcc-docker`. Add a project at
`/home/zcc/workspace` (sample app is in the repo under
`docker/remote-machine/workspace`). This is a pairing trial, not Tailscale Serve.


---

## Self-update

If session open reports a newer server protocol, the daemon downloads the
server artifact, updates its private install, then exits so launchd/systemd
restarts it. Failed attempts fall back to reconnect with a persisted backoff
from 5 seconds to 5 minutes. **Retry update** in Settings → Machines bypasses
the current backoff. A daemon never downgrades itself to an older protocol.

To opt out, remove `--auto-update` from the LaunchAgent plist or systemd unit,
then reload the service.

---

## Where to go next

- **[Getting started](./getting-started.md)** — first project and first agent.
- **[Using Zana](./using-zana.md)** — Inbox, Agents, and the
  day-to-day surfaces.
