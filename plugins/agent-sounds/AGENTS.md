# Sound Studio plugin

- Keep sounds, imports, policy and playback in this plugin. Core only exposes generic status subscriptions.
- Use public `@zana-ai/zcc-plugin-sdk` APIs and the host's React. Do not import core renderer modules or request daemon credentials.
- `policy.ts` is the intentional customization seam. Imported packs contain audio and category metadata only, never executable code.
- Keep bounds, silent baselines, unknown/error handling, cross-window playback ownership, and disposal guarantees when changing rules.
- Persist through plugin KV with one serialized mutation queue. Validate audio size/signatures and manifest paths before accepting them.
- The page fills its host slot and owns scrolling; its inner form uses a fixed reading width. Use existing theme tokens and accessible controls.
- Verify focused tests and built Electron behavior. Do not turn notifications on in a real user's profile as a test.
