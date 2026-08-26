# Plugin quickstart

```
zcc plugin new hello --app    # ./zcc-plugin-hello
cd zcc-plugin-hello
zcc plugin install .
zcc plugin dev
```

That writes `package.json` (with a `zcc` block), `server.ts`, optional `app.tsx`,
and `skills/hello/SKILL.md`. Path installs load `server.ts` from source. Start
Zana Command Center, then `zcc plugin ls` should show `hello` as running.
`zcc plugin logs hello -f` tails persisted JSONL.

Official first-party plugins:

```
zcc plugin install builtin:docs
```

Docs is a builtin and auto-installs on boot.

See [`extensions-authoring.md`](./extensions-authoring.md) for slots and the
server API.
