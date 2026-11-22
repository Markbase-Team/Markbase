// What is left of @markbase/node: three modules that shell out to git, gh and
// the Vercel CLI in a project's local checkout (repo-state, repos,
// vercel-preview). Everything else that was here is now @markbase/server (the
// web server) or @markbase/local (the user's machine).
//
// These three could not be given to either side, because both run them:
//   - the runner in @markbase/local (discover-repos, run-ticket-worker), on
//     the user's machine;
//   - the projects feature's handlers, inside the web server's own process:
//     projects.ts calls validateLocalRepoPath, getRemoteOrigin, normalizeRemote
//     and listBranches when a project is created, edited or its branches are
//     listed; runs.ts calls getRepoState (ticket review) and resolvePreviewUrl
//     (ticket preview). Those routes read project.local_path straight off the
//     server's disk, which only means something when the web server runs on
//     the machine that holds the checkout.
// So this package is the one exception to "local imports no other core package", and
// package-boundary.test.ts pins it as exactly that. Whether the handlers
// should keep reading the server's disk, or ask the worker instead, is a
// product decision; once it is made, these files move to local or server and
// this package goes.
//
// Node-only (child_process, node:fs). Nothing here may be imported from a
// "use client" file.

export * from "./repo-state";
export * from "./vercel-preview";
export * from "./repos";
