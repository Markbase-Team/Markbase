// The real Markbase app, laid over a card — when the host lets it load.
//
// A card may frame markbase.so only if the host allows that site for the
// connector. Claude does not, for now, and it blocks the frame without telling
// the card (it does not report which sites it allowed). So the card never
// waits on the frame to show anything: it draws the document itself first
// (./doc-view), and the app is loaded on top, invisible, and shown only once it
// says it is showing (EMBED_READY_MESSAGE, posted by the documents surface in
// embed mode). A frame that never says so is taken away, and the person still
// has the document in front of them, with "Open in Markbase".
//
// Signing the frame in takes a one-minute, single-use hand-off from a
// card-only tool (me_embedSession), so the model never sees it.

/** The card-only tool that hands the card a sign-in address for the frame. */
export const EMBED_SESSION_TOOL = "me_embedSession";

/** How long a frame may take to say it is showing before it is taken away. */
export const EMBED_READY_TIMEOUT_MS = 12000;

export const FRAME_APP_CSS = `
iframe.app { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; z-index: 20; background: #fff; visibility: hidden; }
iframe.app.ready { visibility: visible; }
`;

/**
 * overlayApp(docId): load the app at docId over the card, invisibly; show it
 * once it says it is showing, take it away if it never does. Needs
 * CONFIG.instance and CONFIG.sessionTool. Does nothing a second time.
 */
export const FRAME_APP_JS = String.raw`
var overlaid = false;

function overlayApp(docId) {
  if (overlaid || !CONFIG.instance) return;
  if (mb.frameAllowed(CONFIG.instance) === false) return;
  overlaid = true;
  mb.callTool(CONFIG.sessionTool, docId ? { doc: docId } : {}).then(function (result) {
    var url = result.data && result.data.url;
    if (result.error || typeof url !== "string" || url.indexOf(CONFIG.instance + "/") !== 0) return;
    var frame = document.createElement("iframe");
    frame.className = "app";
    frame.title = "Markbase";
    frame.setAttribute("allow", "clipboard-read; clipboard-write");
    frame.src = url;
    document.body.appendChild(frame);
    var ready = false;
    function onMessage(event) {
      if (event.source !== frame.contentWindow || !event.data || event.data.type !== "markbase:embed-ready") return;
      ready = true;
      frame.classList.add("ready");
      window.removeEventListener("message", onMessage);
    }
    window.addEventListener("message", onMessage);
    setTimeout(function () {
      if (ready) return;
      window.removeEventListener("message", onMessage);
      frame.remove();
    }, CONFIG.readyTimeoutMs || ${EMBED_READY_TIMEOUT_MS});
  }, function () { /* the host would not run the tool: the drawn document stays */ });
}
`;
