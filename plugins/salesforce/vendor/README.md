# sf-agentic-tools v0.1.0

Pinned release from the local sf-agentic-tools project, tag v0.1.0, source commit
06188958bb84c1d8bee3aba084a866c3d3921eb5. The archive, catalog and release manifest
retain their published hashes. SHA256SUMS uses the local catalog filename.

To upgrade, replace the archive, manifest, catalog, notice/license and checksums,
update the dependency and adapter version, regenerate the lockfile, and run the
policy, real-runtime and built-Electron tests. Review new action effect flags and
filesystem inputs before exposing them.

The build bundles the SDK separately so import.meta.url resources remain beside
it, relocates dependency resource directories, and copies non-code resources.
Salesforce Core's public memory-logger mode replaces its relative Pino worker
transport within this isolated bundle; its error buffer is capped at 64 entries.
The computed Agent Script SDK import is made literal so the dependency is included.
This avoids changing the host environment or shipping a node_modules tree.
Bundled dependency licenses are collected in THIRD_PARTY_NOTICES.md.
