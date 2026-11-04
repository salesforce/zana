# Plugin Workflow

## Commands

- `zcc plugin new <name> [--app] [--dir]` creates TypeScript scaffold. Default destination: `./zcc-plugin-<id>`. `--app` adds frontend; default server-only.
- `zcc plugin types [dir]` synchronizes bundled SDK `.d.ts`; use `--check` in CI.
- `zcc plugin install <source>` accepts `path:`, `git:`, `npm:`, or `builtin:<name>`.
- `zcc plugin reload <id>` performs one-shot HTTP reload and needs running app.
- `zcc plugin dev [dir]` watches declared app after path install. Failed build retains last good generation.
- `zcc plugin build [dir]` writes minified `dist/`; no running app.
- `zcc plugin list`, `zcc plugin logs <id> [-n] [-f]`, and `zcc plugin run <pluginId> <args…>` inspect or invoke plugin.

Path installs load `./server.ts` through jiti. Published packages declare JS entry, usually in `dist`. Packaged Zana downloads pinned build tooling once beneath `<ZCC_DATA_DIR>/plugins/toolchain-<platform>-<arch>-<versions>`; no global esbuild or temporary CLI copy. `package.json` is read each dev cycle, including `zcc.app` changes.

Keep `extension-creator` for an already-open local extension directory. This skill owns full plugin SDK contract.
