#!/usr/bin/env bash
# Back-compat: enroll the repo Docker remote machine against pnpm dev.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/docker-remote-machine.sh" --join "$@"
