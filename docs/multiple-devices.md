# Using Zana on multiple machines

There are two ways to use another computer with Zana Command Center.
They work together after you install a host daemon:

- **Enrolled machines** run a host daemon. The other box outbound-connects to
  this app. Projects and threads then execute there.
- **SSH remotes** start as a different path: this machine's daemon `ssh`s into
  the box. The composer **Install** control uses that SSH channel to bootstrap
  a host daemon, then converts the project so later threads run on the enrolled
  machine instead of SSH PTY.

An SSH remote has **three execution modes**:

1. **SSH PTY (default)** — the coding CLI itself runs on the box via `ssh -t`.
   Send stays allowed; this machine's host daemon must be connected (it owns
   `~/.ssh`).
2. **Local agent, remote tools** — a per-project toggle on the Remote workspace.
   The LLM/harness stays on this machine; Read, Write, Edit, Glob, Grep, and
   Shell run on the remote over the existing SSH ControlMaster path. Composer
   shows **Local agent · remote tools**. Install remains available.
3. **Enrolled daemon** — composer **Install** puts a host-daemon on the box and
   binds the project to it. Later threads run there over RPC, not SSH.

SSH is the bootstrap and repair channel. The enrolled daemon is the execution
path after Install. Copy-paste join remains for boxes you cannot SSH to from
this machine.

---

## Reachability (public origin)

The product server still binds **loopback** (`127.0.0.1`). Another computer
cannot enroll against `http://127.0.0.1:<port>`. The public door is Heroku
app `zcc`: the same hostname serves the docs/marketplace site **and** pairing
(`/install.sh`, enroll, host websocket). Zana on this Mac dials out to
`wss://<origin>/_zcc/relay` — Heroku never inbound-connects to the laptop.

Set the hostname in **one** of these places (first match wins):

1. Env `ZCC_APP_URL`
2. **Settings → Machines → Public app URL**
3. The repo-root file [`public-app-url`](../public-app-url) (one URL, comments allowed)

Set the matching **Relay token** (Settings or env `ZCC_RELAY_TOKEN`). It must
equal Heroku config `ZCC_RELAY_TOKEN`. One laptop per token: a second desktop
with the same token steals the tunnel.

```bash
# public-app-url
https://zcc-7808c5bc8f3d.herokuapp.com
```

Machines shows **Relay: Connected**, **Offline**, or **Not configured**. If the
origin is set but the tunnel is down, Install fails with `relay_offline` (keep
Zana running). If no token is configured, a Tailscale Serve origin still works
as before.

That origin is used in the join command and as the **Host-header allowlist**
on the laptop (enroll, host websocket, `/install.sh`). Change the file (or
Settings) when the hostname changes — no code edits.

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
**Install** / **Fix** pipes that same tarball over SSH from this machine
instead of asking the remote to `curl` it.

Each joined server gets its own daemon instance and data directory
(`~/.zcc-machines/<server-host>`). Joining never touches a full local install's
`~/.zcc`. Subsequent runs reuse the reserved local API port under
`~/.zcc-machines/host-daemon-ports/`; pass `--host-daemon-port <port>` to
override.

On macOS the installer loads a LaunchAgent; on Linux it enables a systemd user
unit. Both start the daemon with `--auto-update`.

---

## Install or Fix from the composer

When the selected project is an SSH remote, the composer shows **Install**.
That SSHs from this machine, unpacks the host daemon, joins it to the app, and
rewrites the project to run on that enrolled host.

When an already-paired machine is offline, the composer shows **Fix**. If Zana
stored an SSH alias for that host, Fix restarts the LaunchAgent or systemd user
unit and reinstalls if restart does not reconnect. If no SSH alias is stored,
Fix asks you to pick a host from `~/.ssh/config`, then retries.

Install and Fix need the same **Public app URL** as Add machine (not loopback).
This machine's host daemon must be connected — it owns `~/.ssh` and performs
the SSH. If SSH cannot run, copy the Settings → Add machine join command.

**Add remote project** runs that same Install by default. Uncheck **Install
host daemon** to keep SSH PTY only. If the SSH host is already enrolled,
the new project binds to that machine instead of installing again.

Send is blocked only when the *execution* host is an enrolled machine that is
offline. SSH remotes keep working over SSH PTY, or over the local-agent /
remote-tools toggle, until you install a daemon.

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

To enroll a Linux host-daemon against a `pnpm dev` server on this machine:

```bash
pnpm docker:host-daemon
```

That script publishes a loopback-only TCP proxy so Docker Desktop can reach
`127.0.0.1`, mints a join code (or takes `--join-code` / `--host-id` from
**Add machine**), and leaves the container running. Settings → Machines should
show hostname `zcc-docker` as online. Ctrl+C stops the container and restores
the previous Public app URL.

This is a pairing trial, not Tailscale Serve. Use Serve when the other box is a
real machine on your tailnet.


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
- **[Using Zana Command Center](./using-zana.md)** — Inbox, Agents, and the
  day-to-day surfaces.
