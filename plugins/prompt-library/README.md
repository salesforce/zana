# Prompt Library

Install **Prompt Library** from the Plugins catalogue. It is optional and is
not automatically installed. Its button appears beside the composer in a
thread or New Chat.

Choose Starred, Thread, Project or All to search and reuse prompts. Starred
prompts retain text, mentions and attachment provenance. Uploaded attachments
from another project are copied into the destination before sending or
queuing; machine-local paths require the same host. Remove unavailable
attachments or upload them again before using them on another host.

History uses bounded cursor pages. Starred storage retains at most 100 prompts
and 240 KB; each structured prompt is capped at 32 KB. Older saved prompts are
evicted when these limits are reached.

From the repository root, rebuild the shipped app and server artifacts with:

```sh
pnpm exec tsx plugins/prompt-library/build.ts
```

The host supplies the composer and paged-history APIs. The plugin needs no
filesystem or network capability of its own.
