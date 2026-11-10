# Contributing to Markbase

Thanks for wanting to help. This page covers the legal parts — the licence you
are contributing under, the sign-off we need, and what to do when you bring code
from somewhere else. For how the repo is laid out and how to run it, see
[README.md](./README.md).

## Licence

Markbase is [Apache-2.0](./LICENSE). Contributions are accepted under the same
licence — Apache-2.0 §5 says so, and opening a pull request is how you agree to
it:

> Unless You explicitly state otherwise, any Contribution intentionally
> submitted for inclusion in the Work by You to the Licensor shall be under the
> terms and conditions of this License, without any additional terms or
> conditions.

There is no separate CLA.

## Sign your commits off (DCO)

Every commit needs a `Signed-off-by` line. It certifies you wrote the change, or
have the right to submit it under Apache-2.0 — the
[Developer Certificate of Origin](https://developercertificate.org/) in full.

`git commit -s` adds it:

```
Signed-off-by: Your Name <you@example.com>
```

Use your real name and an address you read. To fix a branch you already wrote:

```bash
git rebase --signoff main
```

## Bringing code from elsewhere

**Say so in the pull request**, before review rather than after. Name where it
came from and its licence. This is not a formality — a licence we cannot comply
with has to be caught before it is merged, not after it ships.

- **Compatible with Apache-2.0** (MIT, BSD, ISC, Apache-2.0): fine. Keep the
  original copyright header, and add it to
  [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
- **Copyleft** (GPL, AGPL, LGPL, SSPL): we cannot take it. Ask first — there is
  usually another way.
- **Unclear or unlicensed**: treat as "cannot take it" until it is clear. Code
  from a blog post, a Stack Overflow answer or a model that reproduced something
  verbatim all count.

The same goes for a new npm dependency: check its licence, and ask if it is not
one of the permissive ones above.

## Trademark

The Markbase name and logo are not covered by the Apache licence — see
[TRADEMARK.md](./TRADEMARK.md). Short version: "X for Markbase" is fine, a fork
needs its own name.

## Before you open a pull request

```bash
npm ci          # NOT npm install — see below
npm run typecheck
npm test
```

> **`npm ci`, not `npm install`.** On an empty or partial `node_modules`,
> `npm install` has produced a tree missing type declarations — dozens of
> phantom type errors in files nobody touched, plus a rewritten lockfile.
> `npm ci` installs the committed tree exactly.

Keep the change focused on what it is for. If you find something else worth
fixing, that is a second pull request.
