# Releasing the CLI

`@markbase/cli` is the `markbase` command and the MCP server agents run
(`npx @markbase/cli mcp`). It is published to npm by GitHub Actions; nobody
runs `npm publish` on their own machine.

## How to release

1. In a PR, change `"version"` in `apps/markbase/package.json`, and run
   `npm install` at the root so `package-lock.json` follows.
2. Run `npm run gen:endpoints`. The agent skill carries the version, and CI
   fails if it is stale.
3. Merge the PR.

The `Release CLI` workflow (`.github/workflows/release-cli.yml`) runs on the
merge, sees a version npm does not have, tests the CLI and publishes it. A few
minutes later `npm view @markbase/cli version` shows the new one.

A merge that touches the package file without changing the version publishes
nothing.

The PR itself rehearses the release: the same workflow runs with
`npm publish --dry-run`, which uploads nothing, so a release that would fail
to build or pack fails in the PR.

## What needs a release and what does not

- **The MCP tools do not.** The MCP server asks the site for its tools each
  time it starts, so a new or changed endpoint reaches agents on deploy. See
  [adding an endpoint](adding-an-endpoint.md).
- **The CLI's own code does:** commands, the installer, how the MCP server
  signs in or gets its key, vault sync.

## If a run fails

Open Actions → Release CLI, read the failed step, fix it on main, then use
**Run workflow** on that page. Running it when the version is already on npm
does nothing, so it is safe to repeat.

A publish refused with a 404 or "not authorized" almost always means the
trusted publisher setting below no longer matches.
Search the Publish step's log for `oidc`: npm says there why it did not
accept the workflow. The usual causes are a field that differs from the table
below, or an entry that allows staged publishes only and not `npm publish`.

## The one-time setting on npmjs.com

There is no npm token in this repository. npm trusts the workflow itself.
On npmjs.com, under the package's **Settings → Trusted publisher**, choose
GitHub Actions and enter:

| Field | Value |
| --- | --- |
| Organization or user | `Markbase-Team` |
| Repository | `Markbase` |
| Workflow filename | `release-cli.yml` |
| Environment name | leave empty |

If the form lists allowed actions, allow `npm publish`.

Things to know:

- The entry cannot be edited. If the repository or the workflow file is ever
  renamed, delete the entry and add a new one.
- A new entry expires if no publish succeeds through it within two days.
- It only works from GitHub's own runners, and the workflow needs
  `id-token: write`, which it has.
- Packages published this way get a provenance statement on npm, linking the
  version to the commit and the run that built it.
