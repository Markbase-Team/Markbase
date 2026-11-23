// HTTPS (and WSS) in front of plain-http local servers, so the embed proof
// runs with Secure cookies the way production does. Local only.
import https from "node:https";
import http from "node:http";
import net from "node:net";
import { readFileSync } from "node:fs";

const tls = { key: readFileSync(new URL("./key.pem", import.meta.url)), cert: readFileSync(new URL("./cert.pem", import.meta.url)) };
const routes = [
  { listen: 3443, target: 3012 }, // the web app
  { listen: 54443, target: 54321 }, // local Supabase (API, auth, realtime)
];

for (const { listen, target } of routes) {
  const server = https.createServer(tls, (req, res) => {
    const headers = { ...req.headers, "x-forwarded-proto": "https", "x-forwarded-host": req.headers.host };
    const up = http.request({ host: "127.0.0.1", port: target, method: req.method, path: req.url, headers }, (r) => {
      // The dev server builds redirects from its own port; say the public one.
      const out = { ...r.headers };
      if (typeof out.location === "string") out.location = out.location.replace(`://localhost:${target}`, `://localhost:${listen}`).replace(`://127.0.0.1:${target}`, `://localhost:${listen}`);
      res.writeHead(r.statusCode ?? 502, out);
      r.pipe(res);
    });
    up.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
  });
  server.on("upgrade", (req, socket, head) => {
    const up = net.connect(target, "127.0.0.1", () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`), "", ""];
      up.write(lines.join("\r\n"));
      if (head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  server.listen(listen, "127.0.0.1", () => console.log(`https://localhost:${listen} -> http://127.0.0.1:${target}`));
}
