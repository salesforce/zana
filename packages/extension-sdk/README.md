# @zana-ai/zcc-extension-sdk

The public TypeScript contract for building Zana Command Center extensions.

## Install

```sh
npm install --save-dev @zana-ai/zcc-extension-sdk
```

## Imports

```ts
import { defineMainModule } from '@zana-ai/zcc-extension-sdk';
import type { RendererEntry } from '@zana-ai/zcc-extension-sdk/renderer';
import type { MainModuleContext } from '@zana-ai/zcc-extension-sdk/main';
```

Available entry points are `@zana-ai/zcc-extension-sdk`, `/renderer`, `/main`,
`/helpers`, and `/testing`.

See the extension authoring guide in the Zana repository for the manifest,
permission, build, and publishing workflow:
https://github.com/salesforce/zana/blob/main/docs/extensions-authoring.md

## Publishing

The package is public. From this workspace, publish a reviewed release with:

```sh
npm publish --workspace @zana-ai/zcc-extension-sdk --access public
```

`prepublishOnly` builds the distributable before publishing.
