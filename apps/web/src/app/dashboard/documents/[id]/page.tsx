// The active document is rendered by DocsShell's keep-alive stack (client), which
// reads the id from the URL — so switching between open tabs never remounts the
// editor or reconnects its CRDT session. This route just makes the URL resolve;
// there's nothing to render server-side here.
//
// (Auth is enforced by middleware + the /api/v1/docs endpoints the client loads
// from, which also resolve capability and return not-found / no-access.)
export default function DocumentPage() {
  return null;
}
