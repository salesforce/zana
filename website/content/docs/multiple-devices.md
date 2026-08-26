# Using Zana on multiple machines

There are two separate ways to use another computer with Zana Command Center.
They are not interchangeable:

- **Enrolled machines** run a host daemon. Settings → Machines pairs the box;
  projects and threads can then execute there. This is the pull-model path.
- **SSH remotes** stay a different path: this machine's daemon `ssh`s into the
  box. Pairing a host daemon does not replace SSH, and SSH does not enroll a
  daemon.

This page is the enrolled-machines path.

---

## Reachability (Tailscale Serve)

The product server still binds **loopback** (`127.0.0.1`). Another computer
cannot enroll against `http://127.0.0.1:<port>`. Publish a private HTTPS origin
with Tailscale Serve, then tell Zana that origin:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:<zcc-port>
```

In **Settings → Machines**, set **Public app URL** to
`https://<machine>.<tailnet>.ts.net` (or restart with `ZCC_APP_URL` set to the
same origin). That URL is used in the join command and as the Host-header
allowlist for enroll, the host websocket, and `/install.sh`.

Do **not** use Tailscale Funnel or bind the product server to `0.0.0.0`. Those
would put an unauthenticated control plane on a network. Tailscale ACLs are the
access boundary for Serve.

Opening the full Zana UI in a browser through that URL is out of scope — the
desktop app on this machine stays the control surface.

---

## Add an execution machine

1. Open **Settings → Machines** and choose **Add machine**.
2. Copy the one-line installer. It looks like:

```bash
curl -fL ${publicAppUrl}/install.sh | sh -s -- \
  --join-code <zcde_...> --host-id <id> --server ${publicAppUrl}
```

3. Run it on the computer that should execute work. The join code expires in
   **15 minutes** and can be redeemed once. The Machines list turns the new row
   online when the daemon's websocket is open.

The installer requires **Node.js 22 or newer** on the remote box. It downloads
the exact host-daemon artifact this server exposes at `/install/zcc-host.tgz`,
so the remote stays on the same protocol as the app you are running.

Each joined server gets its own daemon instance and data directory
(`~/.zcc-machines/<server-host>`). Joining never touches a full local install's
`~/.zcc`. Subsequent runs reuse the reserved local API port under
`~/.zcc-machines/host-daemon-ports/`; pass `--host-daemon-port <port>` to
override.

On macOS the installer loads a LaunchAgent; on Linux it enables a systemd user
unit. Both start the daemon with `--auto-update`.

---

## After it connects

1. **New project** — pick the machine in the host picker and browse its disk
   (or paste a path on that box).
2. **New thread / home composer** — pick the machine when more than one host is
   connected. A project remembers the host it was created on.
3. **Permission ceiling** — Settings → Machines can cap that box at accept-edits
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
