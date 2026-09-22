# BB-derived changes

ZCC adapts code and tests from [get-bb/bb](https://github.com/get-bb/bb), licensed
under the MIT license reproduced in [LICENSE](./LICENSE).

The September 22, 2026 update reviewed BB through commit
`18960354e462d514c0d6071ba1ed0f8f2acd625c`. In particular:

- `5ba6e4917204c558af711515b57801e80df91ce9`: structured path matching and tests in `packages/fuzzy-match`.
- `48bc6a7e9c8819a62ff3d486c803ff186e3afe55`: Codex writer-lock retry logic and process test fixtures in `plugins/provider-codex/src/bridge`.
- `0613621b39d26008bd406bd7a9c6401a3faaa358`: browser machine-selector resolution and regression cases in `plugins/browser-automation`.

Other behavioral adaptations and their ZCC-specific implementations are recorded
in [the update report](../../docs/bb-upstream-update-2026-09-22.md).
