import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocalFileDoc } from "@markbase/docs/ui/local-file-doc";
import { DocsPortsProvider, browserDocsPorts, type DocsPorts } from "@markbase/docs/ui";
import { Toaster } from "@markbase/ui/sonner";
import type { LocalFile } from "../../preload";
import { shell } from "../shell";
import "./viewer.css";

// A markdown file, opened. The same document surface the main window shows,
// backed by the file instead of a cloud document — see <LocalFileDoc /> in the
// docs feature, which is all this page renders.
//
// Every document in Markbase has a cloud id, and the CRDT is keyed by it. A
// file somebody double-clicked in Finder has none — no id, no history, no
// collaborators — so this window offers none of that: no sidebar, no tabs, no
// share. What it does offer is the editor, writing back to the file on disk.
// The file's text arrives over IPC, already read; the page reaches nothing.

// This window's slice of the bridge: the file, and a way to open links outside
// the app. No vaults, no agent, no snapshot host — the preload does not give
// this window those, and the surface takes their absence as a browser would.
const bridge = shell("viewer");
const ports: DocsPorts = {
  ...browserDocsPorts,
  links: { openExternal: bridge.openExternal },
  localFile: bridge.file,
};

function Viewer() {
  const [file, setFile] = useState<LocalFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bridge.file
      .current()
      .then(
        (f) => (f ? setFile(f) : setError("This window was opened without a file.")),
        (e: Error) => setError(e instanceof Error ? e.message : String(e))
      );
  }, []);

  // Keep the window's title in step with what it is showing, so a stack of
  // these is navigable from the Window menu.
  useEffect(() => {
    if (file?.name) document.title = file.name;
  }, [file?.name]);

  if (error) {
    return <LocalFileDoc file={{ path: "", dir: "", name: "Markbase", content: "", error }} />;
  }
  if (!file) return null;
  return <LocalFileDoc file={file} />;
}

createRoot(document.getElementById("root")!).render(
  <DocsPortsProvider value={ports}>
    <Viewer />
    <Toaster />
  </DocsPortsProvider>
);
