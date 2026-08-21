# Plugin quickstart

```
zcc plugin new hello
cd hello
zcc plugin install .
```

That writes `package.json` (with a `zcc` block), `server.mjs`, `app.js`, and
`skills/hello/SKILL.md`. Start Zana Command Center, then `zcc plugin ls` should
show `hello` as running.

Reload while iterating:

```
zcc plugin reload hello
# or
zcc plugin dev .
```

Official first-party plugins:

```
zcc plugin install builtin:zana
zcc plugin install builtin:zana-hub
```

Slack is a builtin and auto-installs on boot.

See [`extensions-authoring.md`](./extensions-authoring.md) for slots and the
server API.
