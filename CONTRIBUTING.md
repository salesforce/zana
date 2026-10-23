# Contributing to Zana

Thanks for contributing to Zana. Contributions to code, documentation, tests,
and issue reports are welcome.

## Before You Start

- Search [existing issues](https://github.com/salesforce/zana/issues) before
  opening a new one. Bug reports should use the
  [Bug report](https://github.com/salesforce/zana/issues/new?template=bug.yml)
  template (also available from the in-app **Report a bug** control).
- Open an issue first for substantial features or behavioral changes so the
  maintainers and community can align on the approach.
- For security vulnerabilities, follow the private reporting process in
  [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development

1. Fork the repository and create a focused branch from `main`.
2. Install dependencies with `npm install`.
3. Make the smallest change that solves the problem and add or update tests.
4. Run the relevant checks:

   ```bash
   npm run typecheck
   npm test
   ```

   Electron E2E changes can also use the optional Linux CI reproduction described
   in [`e2e/README.md`](e2e/README.md#optional-linux-ci-reproduction).

5. Open a pull request against `main`. Explain the problem, the solution, and
   how you tested it. Link any related issue.

### Optional: local TinyNod review before you push

Authorized internal developers can opt in to an advisory AI review that runs
during `git push` alongside Zana's own verification. It never blocks a push and
public CI never runs it. It sends the outgoing diff to an internal AI gateway,
so read the data policy in the guide first.

1. Install TinyNod 2.5.0+ from the CodeNod homepage,
   <https://git.soma.salesforce.com/cc-oms/pr-reviewer> ("tinynod (standalone CLI)").
2. If the CodeNod app is running, import its settings first:
   `tinynod config import --from-app` (settings only, no key). Then store a
   gateway key and a full model id. With DevBar / AI Suite:
   `tinynod config set ai.apiKey "$('/Applications/devbar.app/Contents/MacOS/devbar' auth claude)"`
   then `tinynod config set ai.model claude-opus-5-5`. Without DevBar / AI Suite:
   `tinynod config init`.
3. Opt in: `git config --local zana.tinynod.enabled true` (opt out: set `false`;
   skip once: `TINYNOD_SKIP_HOOK=1 git push`).
4. Push. Read the one-line result, and ask your coding agent to summarize and
   fix findings (prompt in the guide).

Full setup, troubleshooting (`no AI API key configured`, `Access denied`),
result statuses, and the AI-assisted fix workflow:
[`docs/tinynod-local-review.md`](docs/tinynod-local-review.md).

## Pull Request Expectations

- Keep pull requests focused and avoid unrelated formatting or refactors.
- Include tests for behavior changes where practical.
- Update documentation when user-visible behavior changes.
- Use clear commit and pull request descriptions.
- Be responsive to review feedback and keep the branch current with `main`.

## Governance

Zana is maintained by the repository maintainers. Maintainers review
contributions for correctness, security, maintainability, and alignment with
the project's direction.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE.txt).

## Code of Conduct

Participation in this project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
