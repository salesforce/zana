# Zana X launch draft

Status: **Published and verified on 2026-09-20.** The bio update remains blocked by an X error.

Post: https://x.com/RebmannG/status/2101711721337442624

![Zana launch image](zana-launch.png)

The final caption is in `caption.txt`, and the image description is in
`alt-text.txt`. The user has approved uploading `zana-launch.png` and publishing
that caption to `@RebmannG`. The post is live with the approved image, all five
hashtags, and the image description. Do not publish a duplicate.

## Publication and bio retry

- Publication succeeded using Chrome's Copy Image context-menu action on the
  approved local PNG, then pasting it into the X composer. The upload chooser
  remained unusable. The approved caption was unchanged.
- The live post and image were verified in both the home feed and the public
  profile, with status ID `2101711721337442624`.
- Chrome's native upload chooser kept **Open disabled** after selecting the
  valid PNG. Reopening the visible upload menu, keyboard selection, removing
  the file-type filter, and an identical copy at
  `/private/tmp/zana-launch-approved.png` did not resolve it.
- An alternate Finder clipboard approach was not used: Computer Use returned
  `Computer Use was not approved to use Finder`.
- The user also authorized the exact bio `Building "@salesforce" -> Agentforce`.
  X's setup-profile flow returned “Oups, une erreur s'est produite. Veuillez
  réessayer plus tard.” The standard `https://x.com/settings/profile` editor
  also did not persist the edit. Both routes were retried after publication,
  with the same result. The public profile still showed no bio.
- Final visible Chrome tab: `https://x.com/settings/profile`, with the exact
  requested bio entered once (36/160), ready for manual saving or a later retry.

The 1600 × 900 PNG is rendered from the editable `zana-launch.svg`.
`render.mjs` reproduces the image using the website's existing Sharp dependency.
It reuses Zana's existing vector fairy and colors; no AI image-generation tool
or paid API was used. The design brief was: a polished, readable X launch card
introducing Zana as an open-source IDE, with its fairy identity, supported coding
agents, project/team/plugin features, and website.

Product claims were checked against the local README and public repository:
https://github.com/salesforce/zana. The public repository links the canonical
website https://zana-ide.com/.

The extracted product-tour and agents-board frames were inspected as possible
visual references but are not part of the final artwork.
