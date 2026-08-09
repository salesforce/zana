# Third-party licenses — open-source readiness audit

Snapshot taken 2026-07-29 with `license-checker@25.0.1` against the resolved
`node_modules` tree (Node v26.5.0). Covers **production dependencies only**
(devDependencies — build/test tooling that never ships in the packaged app —
are intentionally excluded).

Machine-readable output: [`third-party-licenses.csv`](third-party-licenses.csv)
(550 packages, `module name,license,repository` columns — ready for legal
review or import into an SBOM).

## Regenerating

```bash
npx license-checker --production --excludePrivatePackages --csv \
  --out docs/third-party-licenses.csv
```

`--excludePrivatePackages` drops this repo's own workspace packages
(`zana-command-center`, `@zcc/harness-sdk`) which report as `UNLICENSED`
because they're marked `"private": true` — that's correct, they're not
third-party.

## License mix

| License | Count |
|---|---|
| MIT | 411 |
| Apache-2.0 | 53 |
| ISC | 50 |
| BSD-3-Clause | 25 |
| (MPL-2.0 OR Apache-2.0) | 2 |
| BSD-2-Clause | 2 |
| Python-2.0 | 1 |
| (MIT OR WTFPL) | 1 |
| MIT* | 1 |
| (BSD-2-Clause OR MIT OR Apache-2.0) | 1 |
| Unlicense | 1 |
| BlueOak-1.0.0 | 1 |
| 0BSD | 1 |

All permissive; nothing copyleft (GPL/AGPL/LGPL) or source-unavailable
appeared in the production tree.

## Packages that needed manual verification

`license-checker` flags a few packages whose `license` field isn't a clean
SPDX identifier. Checked each by hand:

| Package | Reported | Verdict |
|---|---|---|
| `khroma@2.1.0` (mermaid dep) | `MIT*` | The `*` just means the bundled `license` file's wording deviates slightly from the canonical MIT template — content confirmed to be standard MIT ("Fabio Spampinato, Andrew Maney"). Permissive, no action needed. |
| `dompurify@3.2.7` / `3.4.11` (monaco-editor, mermaid deps) | `(MPL-2.0 OR Apache-2.0)` | Dual-licensed, consumer picks either. Treat as Apache-2.0 for attribution purposes (no MPL copyleft obligations triggered). |
| `expand-template@2.0.3` (node-pty dep) | `(MIT OR WTFPL)` | Dual-licensed, permissive either way. |
| `argparse@2.0.1` (build tooling dep) | `Python-2.0` | Python Software Foundation license — permissive, OSI-approved. |
| `robust-predicates@3.0.3` (mermaid dep) | `Unlicense` | Public-domain equivalent. Permissive. |

None require a license-compatibility exception or an added attribution
beyond what's already in `docs/third-party-licenses.csv`.

## Workspace packages (not third-party)

`@zcc/cli`, `@zana-ai/zcc-extension-sdk`, `@zcc/streamdeck` declare `"license": "MIT"`
in their own `package.json`. `@zcc/harness-sdk` and the root
`zana-command-center` package are `"private": true` with no `license` field
set — both are this repo's own code, not a dependency to attribute. If the
open-source release ships a root `LICENSE` file, set `"license"` on the root
`package.json` to match it.

## Notes

- Report is dependency-tree license *declarations* as published — not a legal
  opinion. For a formal open-source release, have counsel review the dual-
  licensed and non-SPDX-standard entries above before publishing.
- Re-run after any dependency bump; the CSV is a point-in-time snapshot, not
  generated at build time.
