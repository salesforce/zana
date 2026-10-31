# README artwork

The README opens with a recorded Agent City animation and a product tour.
The supporting diagrams use self-contained SVG masters: crisp at any size,
editable as text or in a vector editor, and independent of external fonts or image hosts.
They follow the [Zana Fairy identity](../../resources/README.md): midnight blue,
pearl white, blue/lavender wings, and a warm golden spark.

| Asset | Purpose |
| :--- | :--- |
| [agent-city-demo.gif](agent-city-demo.gif) | README opening: a 10-second, 900×620 recording of the San Francisco demo, Checkout interior, two floors, and return to the city. Sample data; no sound. |
| [zana-tour-poster.jpg](zana-tour-poster.jpg) | Poster for the narrated product tour. Copied from `website/public/media/zana-tour-poster.jpg`; the website provides captions. |
| [zana-readme-hero.svg](zana-readme-hero.svg) | Retained banner master. Fairy geometry comes from `resources/icon.svg`. |
| [zana-architecture.svg](zana-architecture.svg) | Editable architecture master in the README’s expandable architecture section. |
| [zana-architecture.png](zana-architecture.png) | 2× PNG export for slides, documents, and sharing. |
| [zana-plugins.svg](zana-plugins.svg) | Editable plugin explainer: package, runtime contributions, agent capabilities, and development loop. |
| [zana-plugins.png](zana-plugins.png) | 2× plugin explainer export for slides, documents, and sharing. |
| [product-demo.gif](product-demo.gif) | Previous product animation, retained for existing links. |

## Refresh the Agent City recording

Record the public [Agent City demo](https://zana-ide.com/) with sample data. Keep
its heading and sample-data caption visible, and make the first frame useful
when animation is disabled. The README links the recording to the live demo;
the GIF itself is not interactive.

The current sequence is 3 seconds of city, 3 seconds on Checkout floor 1,
2 seconds on floor 2, then 2 seconds back in the city. Frames were captured at
8 fps with a 900×620 crop; roster rows were hidden only in the recording layout
to keep the image height fixed. No product source was changed for the capture.
Encode numbered PNG frames with a shared palette, then optimize losslessly:

```bash
ffmpeg -framerate 8 -i /path/to/frames/%03d.png \
  -filter_complex '[0:v]split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle' \
  -loop 0 agent-city-demo.gif
gifsicle -O3 agent-city-demo.gif -o docs/assets/agent-city-demo.gif
```

Keep the result below 2 MB and inspect the overview, both interior floors,
and loop boundary. The current asset is about 0.9 MB.

The narrated tour is the existing `website/public/media/zana-tour.mp4`, uploaded
as a GitHub attachment for native README playback rather than copied into Git
again. Keep a link to `https://zana-ide.com/#demo` beside it for captions.

## Architecture scope

The diagram shows **logical responsibilities in the packaged desktop**, not
an exhaustive process or network map. In particular:

- The product server owns policy, project identity, thread state, and the
  plugin host. Electron supervises the local runtime and retains IPC, MCP,
  and native compatibility adapters.
- Threads use signed host commands, the host daemon, the agent runtime, and
  provider bridges. CLI Agents still use the desktop compatibility launch
  path into host harness modules and PTYs; they do not all use the Thread RPC path.
- Installed plugins are full-trust server code with optional UI contributions.
  The retired stakeholder image’s sandboxed-extension model does not describe
  the current PluginService.
- Local repositories, enrolled machines, and SSH projects are supported
  project locations; the footer does not imply identical routing for every
  execution surface.

Before changing the diagram, check these implementation sources:

- [Runtime supervisor](../../apps/desktop/src/runtime/runtime-supervisor.ts)
- [Product server entry](../../apps/server/src/utility-entry.ts)
- [Thread host commands](../../apps/server/src/services/threads/thread-host-commands.ts)
- [Agent runtime adapter](../../apps/host-daemon/src/agent-runtime-adapter.ts)
- [CLI Agent HTTP compatibility adapter](../../apps/server/src/http/cli-agent-ops.ts)
- [Control SDK execution boundaries](../control-sdk.md)
- [Plugin trust model](../extensions.md)

The broader [architecture guide](../architecture/high-level-architecture.md)
describes the package boundaries and runtime in more detail.

## Plugin explainer scope

The plugin artwork follows the common `package.json` → `zcc` contribution
model. It shows optional server and UI entries, their RPC/event connection,
and the separate skills, Thread-tool, and CLI-MCP paths. Specialized provider
and host-side bridges are outside this view.

Keep these distinctions when editing:

- Server code runs full-trust in the product server. UI mounts in the React
  interface; rendering error boundaries are not a security sandbox.
- `zcc.mcpServers` configures supported CLI / PTY integrations. Thread tools
  come from `zcc.agents.registerTool`, not that manifest map.
- Durable skills are declared in `zcc.skills`; server code may also contribute
  extra skill roots and session instructions at runtime.
- `zcc plugin dev` watches, rebuilds, and reloads. A successful server reload
  replaces the previous instance and runs its disposal hooks.

Implementation references:

- [PluginService installation and lifecycle](../../apps/server/src/plugins/plugin-service.ts)
- [Server API and cleanup](../../apps/server/src/plugins/plugin-api.ts)
- [Manifest parser](../../packages/domain/src/plugin-manifest.ts)
- [UI bundle loader](../../apps/app/src/plugins/plugin-app-loader.ts)
- [App SDK and RPC](../../packages/plugin-sdk/src/app.ts)
- [Plugin SDK reference](../extensions-sdk-reference.md)

## Export the PNGs

After editing an SVG, regenerate the checked-in PNGs from the repository root
with the website’s installed Sharp dependency (`pnpm install`):

```bash
node --input-type=module <<'JS'
import { createRequire } from 'node:module';
const sharp = createRequire(`${process.cwd()}/website/package.json`)('sharp');
for (const name of ['zana-architecture', 'zana-plugins']) {
  await sharp(`docs/assets/${name}.svg`, { density: 144 })
    .png()
    .toFile(`docs/assets/${name}.png`);
}
JS
```

Keep labels readable at the README’s display width. Inspect the rendered
images after edits, and update the README’s alt text if the architecture
changes. SVGs must remain self-contained: no scripts, remote resources, or
`foreignObject` content.
