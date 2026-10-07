This directory is a plugin-owned runtime asset. `node ../build.mjs` writes
`config.json` from the build environment's `ZCC_GA4_MEASUREMENT_ID` and
`ZCC_GA4_API_SECRET`, or writes empty defaults when neither is configured.
The generated file and temporary files are git-ignored. Never commit credentials.
