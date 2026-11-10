// Build the macOS app icon from the web app's logo — the ONE mark in git.
//
// macOS does NOT round or pad app icons for you: the icon file must already be a
// rounded rectangle with the art inset, or it looks oversized and square next to
// every other dock icon. So we composite the logo onto Apple's icon grid (an
// 824-on-1024 rounded rect, leaving the transparent margin macOS fills with its
// drop shadow) and then emit the .icns.
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "..", "web", "public", "logo.png");
const OUT = join(here, "..", "build", "icon.icns");
const PNG = join(here, "..", "build", "icon.png");

const SIZE = 1024;
const MARGIN = 100; // Apple's grid: 824 rounded rect centered on 1024.
const RECT = SIZE - MARGIN * 2;
const RADIUS = 185;
const BG = "#e5ff6e"; // brand lime; the black mark reads well on it. Change here to restyle.
const LOGO = 460; // ~45% of the canvas — padded well inside the rounded rect.

const bg = Buffer.from(
  `<svg width="${SIZE}" height="${SIZE}"><rect x="${MARGIN}" y="${MARGIN}" ` +
    `width="${RECT}" height="${RECT}" rx="${RADIUS}" ry="${RADIUS}" fill="${BG}"/></svg>`
);

const logo = await sharp(SRC)
  .resize(LOGO, LOGO, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toBuffer();

const master = await sharp(bg)
  .composite([{ input: logo, top: Math.round((SIZE - LOGO) / 2), left: Math.round((SIZE - LOGO) / 2) }])
  .png()
  .toBuffer();

const iconset = join(mkdtempSync(join(tmpdir(), "mb-icon-")), "icon.iconset");
mkdirSync(iconset, { recursive: true });
for (const sz of [16, 32, 64, 128, 256, 512]) {
  await sharp(master).resize(sz, sz).toFile(join(iconset, `icon_${sz}x${sz}.png`));
  await sharp(master).resize(sz * 2, sz * 2).toFile(join(iconset, `icon_${sz}x${sz}@2x.png`));
}
mkdirSync(dirname(OUT), { recursive: true });
// The composited master, for the dev dock icon (setIcon takes a PNG).
await sharp(master).toFile(PNG);
// The menu bar icon: the bare mark, no lime, no rounded rect. macOS treats it
// as a template image — only the alpha channel counts — and tints it to match
// the bar. 18pt is the height a menu bar extra gets; the @2x is for Retina.
for (const [name, px] of [["trayTemplate.png", 18], ["trayTemplate@2x.png", 36]]) {
  await sharp(SRC)
    .resize(px, px, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(join(dirname(OUT), name));
}
try {
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", OUT]); // macOS packaging
  console.log("wrote", OUT, "and", PNG, "from", SRC);
} catch {
  console.log("wrote", PNG, "from", SRC, "(iconutil unavailable — .icns skipped)");
}
