#!/usr/bin/env node
/**
 * Consensus is no longer a shipped plugin. Running this used to write
 * bundled-extensions/consensus and seed ~/.zcc/extensions/consensus, which
 * put it back in the Plugins list. It now refuses to package.
 */
console.error('Consensus is not a shipped plugin; packaging is disabled.');
process.exit(1);
