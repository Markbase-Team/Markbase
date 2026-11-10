# Third-party notices

Markbase is [Apache-2.0](./LICENSE). It includes third-party code under other
permissive licences, listed here. Adding vendored or adapted code means adding
it here too — see [CONTRIBUTING.md](./CONTRIBUTING.md).

This file covers code **in this repository**. It is not the dependency tree;
for that, `npm ls` and each package's own licence.

## Claudian — MIT

`packages/core/agent` adapts portions of
[Claudian](https://github.com/YishenTu/claudian): the Claude message-transform
pipeline, the shared chunk model, and related helpers, with the coupling to the
Obsidian host removed.

Full attribution and the MIT licence text:
[`packages/core/agent/NOTICE.md`](./packages/core/agent/NOTICE.md).
