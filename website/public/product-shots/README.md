# Product screenshots

`website/lib/product-shots.ts` is the source of truth for every public product
shot. Each page renders a deliberate browser-frame placeholder until its registry
entry receives a `src` value.

## Replace a placeholder

1. Capture a screenshot at 2x scale with no customer data, access tokens,
   personal paths, private repositories, or terminal history visible.
2. Export as an optimized WebP in this directory. Use the shot id as the
   filename, for example `agents-board.webp`.
3. Set `src: '/product-shots/agents-board.webp'` for the matching entry in
   `website/lib/product-shots.ts`.
4. Review the entry's `alt` text and update it when the screenshot depicts a
   different state.

## Capture dimensions

| Frame | Minimum exported size | Intended placements |
| --- | --- | --- |
| Wide | 1600 x 1000 | Hero, cockpit, agents board, marketplace |
| Standard | 1440 x 900 | Features, installation, terminal, inbox |
| Portrait | 1000 x 1250 | Dialogs, consent, focused settings views |

Keep important details inside the central 80% of the frame. The site preserves
each frame's ratio on small screens, so a screenshot should remain useful without
requiring its text to be read for the surrounding page to make sense.
