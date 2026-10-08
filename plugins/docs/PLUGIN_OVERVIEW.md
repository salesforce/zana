Keep durable project knowledge in a Library that you and your agents share: findings, decisions, runbooks, postmortems and ideas, as Markdown. Each project has its own Library, and a global Library holds notes that apply everywhere.

Writing a spec, RFC or ADR to review? Use the Design Docs plugin. The Library is for notes and findings that agents look up and build on.

## What you get

- A Library page in the sidebar and a Library tab in each project, with a folder tree, search, tags, and a rich Markdown editor. Tables, images and YAML frontmatter are supported.
- A Markdown opener for `.md` files from file links.
- `@` mentions. Type `@` in the composer and pick from the Library group to attach a document. The agent gets its current content at send time.
- Library cards in agent replies. A card opens the document beside the conversation.

## For agents

Agents get the `library-curator` skill and the `library_list`, `library_read`, `library_write` and `library_remove` tools. They check the Library before repeating work, and save findings worth keeping.
