# Zana brand assets

Zana is an AI fairy: a pearl-white silhouette, blue/lavender wings, and a warm golden spark on a midnight tile.

| Asset | Use |
| --- | --- |
| `icon.svg` | Editable full-color master; README and app artwork |
| `icon.icns`, `icon.iconset/`, `icon-1024.png` | Packaged desktop app |
| `icon-dev.png` | Development app, with a gold DEV badge |
| `zana-glyph.svg` | Monochrome fairy master for menu-bar and Stream Deck marks |
| `../website/public/zana-mark.svg` | Simplified website header/footer mark |
| `../website/public/favicon.svg` | Small-size browser master; also copied to the browser-hosted app |
| `../website/public/zana-icon-512.png` | Local artwork used by social-card generation |

Regenerate derived assets from the repository root:

```sh
node scripts/generate-brand-assets.mjs
iconutil -c icns resources/icon.iconset -o resources/icon.icns
```

The exporter uses the website's installed Sharp dependency. `iconutil` requires macOS. The generated tray alpha mask and Stream Deck path are checked in, so normal app builds do not need an image compiler. Do not hand-edit generated copies.

The monochrome tray image must remain a macOS template image. Its attention variant retains the red dot and switches the fairy between black and white with the menu-bar theme.
