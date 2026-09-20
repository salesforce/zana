# Fairy website artwork

`zana-fairy.svg` reuses the Fairy geometry and constellation from
`docs/assets/zana-readme-hero.svg`, with a transparent background and a cropped
viewBox. The original Fairy master is `resources/icon.svg`. Keep the root
`fill="none"` so the constellation circles remain unfilled.

`zana-architecture.svg` and `zana-plugins.svg` are complete copies of the
editable masters in `docs/assets/`. When those masters change, copy them here
as well. The website links to these larger reference illustrations; the
homepage renders responsive, selectable-text summaries in `BrandStories.tsx`.

The shared site palette lives in `app/globals.css`; the product-story layouts
live in `app/fairy.css`. Light mode uses darker blue, lavender, and gold text
for contrast on pearl surfaces.
