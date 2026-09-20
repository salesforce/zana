The website now carries Zana’s Fairy identity through the homepage, Plugins and Features pages, navigation, and social previews. Visitors can follow a clear product story from Projects and agents through Inbox decisions, saved findings, plugins, and the architecture.

- Add responsive Fairy artwork and readable architecture/plugin illustrations, with coordinated dark and light themes.
- Replace the autoplay loop with a chapter-based demo, playback controls, reduced-motion support, and a compact mobile presentation.
- Refresh navigation, product copy, and social sharing imagery; keep download fallbacks at 2.2.1.
- Preserve the committed marketplace feed when building the website-only Heroku container.

Validation: GitHub CI typecheck and full repository unit tests passed; production website build; 162 website tests; component tests under the repository-wide runner; desktop/mobile and light/dark visual review. The production container is built from this branch and keeps the existing pairing front door.

Deployed to [zana-ide.com](https://zana-ide.com/) as Heroku release **v26**, image revision `268af7a2a9d8092178967b33aec4e14c31d43ea7`. Live page, artwork, marketplace, and social-preview checks pass.
